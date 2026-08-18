import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentsRepository } from './comments.repository';

@Injectable()
export class CommentsService {
  constructor(private readonly commentsRepository: CommentsRepository) {}

  async findByPost(postId: string, query: PaginationQueryDto) {
    await this.ensurePostCanBeViewed(postId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const result = await this.commentsRepository.findByPostId(postId, {
      page,
      limit,
    });

    return {
      items: result.items.map((comment) => this.formatComment(comment)),
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async findReplies(commentId: string, query: PaginationQueryDto) {
    const parent = await this.commentsRepository.findById(commentId);

    if (!parent) {
      throw new NotFoundException('Comment thread not found');
    }

    // Currently only root comment can own replies in current design
    if (parent.parentId !== null) {
      throw new NotFoundException('Comment is not a root comment');
    }

    await this.ensurePostCanBeViewed(parent.postId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const result = await this.commentsRepository.findReplies(commentId, {
      page,
      limit,
    });

    return {
      items: result.items.map((comment) => this.formatComment(comment)),
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async create(postId: string, dto: CreateCommentDto, userId: string) {
    await this.ensurePostCanBeCommentedOn(postId, userId);

    const comment = await this.commentsRepository.create({
      postId,
      authorId: userId,
      content: dto.content.trim(),
    });

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

    await this.commentsRepository.softDelete(comment.id, comment.postId);

    return {
      message: 'Comment deleted successfully',
    };
  }

  /**
   * Used for public comment reads.
   */
  private async ensurePostCanBeViewed(postId: string) {
    const post = await this.commentsRepository.findPostById(postId);

    if (
      !post ||
      post.deletedAt ||
      post.status !== 'PUBLISHED' ||
      post.visibility !== 'PUBLIC'
    ) {
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
    const post = await this.commentsRepository.findPostById(postId);

    if (!post || post.deletedAt || post.status !== 'PUBLISHED') {
      throw new NotFoundException('Post not found');
    }

    if (post.visibility === 'PUBLIC') {
      return post;
    }

    if (post.visibility === 'FOLLOWERS_ONLY') {
      if (post.authorId === userId) {
        return post;
      }

      const follow = await this.commentsRepository.isFollowing(
        userId,
        post.authorId,
      );

      if (follow) {
        return post;
      }
    }

    throw new NotFoundException('Post not found');
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
