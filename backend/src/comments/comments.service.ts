import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentsRepository } from './comments.repository';
import { PostVisibilityService } from '../post-visibility/post-visibility.service';
import { UserInterestService } from '../recommendation/user-interest.service';
import { resolvePagination, toPaginated } from '../common/utils/paginated';

@Injectable()
export class CommentsService {
  constructor(
    private readonly commentsRepository: CommentsRepository,
    private readonly postVisibility: PostVisibilityService,
    private readonly userInterestService: UserInterestService,
  ) {}

  async findByPost(postId: string, query: PaginationQueryDto, userId?: string) {
    await this.ensurePostCanBeViewed(postId, userId);

    const { page, limit } = resolvePagination(query);

    const result = await this.commentsRepository.findByPostId(postId, {
      page,
      limit,
    });

    return toPaginated(
      result.items.map((comment) => this.formatComment(comment)),
      { page, limit, total: result.total },
    );
  }

  async findReplies(
    commentId: string,
    query: PaginationQueryDto,
    userId?: string,
  ) {
    const parent = await this.commentsRepository.findById(commentId);

    if (!parent) {
      throw new NotFoundException('Comment thread not found');
    }

    // Currently only root comment can own replies in current design
    if (parent.parentId !== null) {
      throw new NotFoundException('Comment is not a root comment');
    }

    await this.ensurePostCanBeViewed(parent.postId, userId);

    const { page, limit } = resolvePagination(query);

    const result = await this.commentsRepository.findReplies(commentId, {
      page,
      limit,
    });

    return toPaginated(
      result.items.map((comment) => this.formatComment(comment)),
      { page, limit, total: result.total },
    );
  }

  async create(postId: string, dto: CreateCommentDto, userId: string) {
    await this.ensurePostCanBeCommentedOn(postId, userId);

    const comment = await this.commentsRepository.create({
      postId,
      authorId: userId,
      content: dto.content.trim(),
    });

    /**
     * Recommendation updates are best-effort and should not block
     * the core comment interaction.
     */
    void this.userInterestService.recordPostInteraction(
      userId,
      postId,
      'COMMENT',
    );

    return this.formatComment(comment);
  }

  async reply(commentId: string, dto: CreateCommentDto, userId: string) {
    const parent = await this.commentsRepository.findById(commentId);

    if (!parent || parent.deletedAt) {
      throw new NotFoundException('Comment thread not found');
    }

    /*
     * MVP supports only one level:
     *
     * Comment
     * └── Reply
     *
     * Reply → Reply is intentionally not supported yet.
     */
    if (parent.parentId !== null) {
      throw new ForbiddenException('Replies to replies are not supported');
    }

    await this.ensurePostCanBeCommentedOn(parent.postId, userId);

    const reply = await this.commentsRepository.create({
      postId: parent.postId,
      authorId: userId,
      parentId: parent.id,
      content: dto.content.trim(),
    });

    /**
     * Recommendation updates are best-effort and should not block
     * the core reply interaction.
     */
    void this.userInterestService.recordPostInteraction(
      userId,
      parent.postId,
      'COMMENT',
    );

    return this.formatComment(reply);
  }

  async update(commentId: string, dto: UpdateCommentDto, userId: string) {
    const comment = await this.commentsRepository.findById(commentId);

    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.authorId !== userId) {
      throw new ForbiddenException('You can only update your own comment');
    }

    const updatedComment = await this.commentsRepository.update(
      commentId,
      dto.content.trim(),
    );

    return this.formatComment(updatedComment);
  }

  async remove(commentId: string, userId: string) {
    const comment = await this.commentsRepository.findById(commentId);

    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own comment');
    }

    const deleted = await this.commentsRepository.softDelete(
      comment.id,
      comment.postId,
    );

    if (deleted) {
      /**
       * Recommendation updates are best-effort and should not block
       * the core comment deletion.
       */
      void this.userInterestService.recordPostInteraction(
        userId,
        comment.postId,
        'COMMENT_REMOVE',
      );
    }

    return {
      message: 'Comment deleted successfully',
    };
  }

  /**
   * Checks whether the current user can view comments for a post.
   *
   * PUBLIC posts are readable by everyone.
   * FOLLOWERS_ONLY posts are readable by the author or followers.
   */
  private async ensurePostCanBeViewed(postId: string, userId?: string) {
    const post = await this.commentsRepository.findPostById(postId);

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const viewable = await this.postVisibility.canView(post, userId);

    if (!viewable) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  /**
   * Central place for comment interaction rules.
   * Later this can also check locked posts, moderation,
   * follower-only visibility, blocked users, etc.
   */
  private async ensurePostCanBeCommentedOn(postId: string, userId: string) {
    return this.ensurePostCanBeViewed(postId, userId);
  }

  private formatComment<
    T extends {
      id: string;
      postId: string;
      authorId: string;
      parentId: string | null;
      content: string;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      author: {
        id: string;
        name: string;
        image: string | null;
      };
      _count?: {
        replies: number;
      };
    },
  >(comment: T) {
    const { _count, ...rest } = comment;

    return {
      ...rest,

      // Preserve the thread when a parent comment is deleted,
      // but do not expose its old content.
      content: comment.deletedAt ? null : comment.content,

      replyCount: _count?.replies ?? 0,
    };
  }
}
