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
import { EventPublisherPort } from '../domain-events/event-publisher.port';
import { PrismaService } from '../prisma/prisma.service';
import { MentionsService } from '../mentions/mentions.service';

@Injectable()
export class CommentsService {
  constructor(
    private readonly commentsRepository: CommentsRepository,
    private readonly postVisibility: PostVisibilityService,
    private readonly userInterestService: UserInterestService,
    private readonly eventPublisher: EventPublisherPort,
    private readonly prisma: PrismaService,
    private readonly mentions: MentionsService,
  ) {}

  async findByPost(postId: string, query: PaginationQueryDto, userId?: string) {
    await this.ensurePostCanBeViewed(postId, userId);

    const { page, limit } = resolvePagination(query);

    const result = await this.commentsRepository.findByPostId(postId, {
      page,
      limit,
    });

    const mentioned = await this.commentsRepository.findMentionedUsernames(
      result.items.map((comment) => comment.id),
    );

    return toPaginated(
      result.items.map((comment) =>
        this.formatComment(comment, mentioned.get(comment.id)),
      ),
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

    const mentioned = await this.commentsRepository.findMentionedUsernames(
      result.items.map((comment) => comment.id),
    );

    return toPaginated(
      result.items.map((comment) =>
        this.formatComment(comment, mentioned.get(comment.id)),
      ),
      { page, limit, total: result.total },
    );
  }

  async create(postId: string, dto: CreateCommentDto, userId: string) {
    const post = await this.ensurePostCanBeCommentedOn(postId, userId);
    const content = dto.content.trim();
    const mentionTargetIds = await this.resolveMentionTargets(
      content,
      post,
      userId,
    );

    const comment = await this.prisma.$transaction(async (transaction) => {
      const createdComment = await this.commentsRepository.create(transaction, {
        postId,
        authorId: userId,
        content,
      });

      await this.eventPublisher.publish(
        {
          type: 'comment.created',
          aggregateId: createdComment.id,
          payload: {
            commentId: createdComment.id,
            postId,
            postAuthorId: post.authorId,
            actorId: userId,
            parentCommentId: null,
            parentCommentAuthorId: null,
          },
        },
        transaction,
      );

      await this.mentions.publishMentions(
        {
          targetIds: mentionTargetIds,
          actorId: userId,
          entityType: 'COMMENT',
          entityId: createdComment.id,
        },
        transaction,
      );

      return createdComment;
    });

    void this.userInterestService.recordPostInteraction(
      userId,
      postId,
      'COMMENT',
    );

    return this.formatComment(comment);
  }

  async reply(commentId: string, dto: CreateCommentDto, userId: string) {
    const parent = await this.commentsRepository.findById(commentId);

    if (!parent || parent.deletedAt || parent.status === 'HIDDEN') {
      throw new NotFoundException('Comment thread not found');
    }

    if (parent.parentId !== null) {
      throw new ForbiddenException('Replies to replies are not supported');
    }

    const post = await this.ensurePostCanBeCommentedOn(parent.postId, userId);
    const content = dto.content.trim();
    const mentionTargetIds = await this.resolveMentionTargets(
      content,
      post,
      userId,
    );

    const reply = await this.prisma.$transaction(async (transaction) => {
      const createdReply = await this.commentsRepository.create(transaction, {
        postId: parent.postId,
        authorId: userId,
        parentId: parent.id,
        content,
      });

      await this.eventPublisher.publish(
        {
          type: 'comment.created',
          aggregateId: createdReply.id,
          payload: {
            commentId: createdReply.id,
            postId: parent.postId,
            postAuthorId: post.authorId,
            actorId: userId,
            parentCommentId: parent.id,
            parentCommentAuthorId: parent.authorId,
          },
        },
        transaction,
      );

      await this.mentions.publishMentions(
        {
          targetIds: mentionTargetIds,
          actorId: userId,
          entityType: 'COMMENT',
          entityId: createdReply.id,
        },
        transaction,
      );

      return createdReply;
    });

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

    if (comment.status === 'HIDDEN') {
      throw new ForbiddenException('This comment was hidden by a moderator');
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
  /** Resolved before the transaction opens: visibility checks use their own connection. */
  private resolveMentionTargets(
    content: string,
    post: Parameters<PostVisibilityService['canView']>[0],
    actorId: string,
  ) {
    return this.mentions.resolveTargets({
      text: content,
      actorId,
      canView: (mentionedId) => this.postVisibility.canView(post, mentionedId),
    });
  }

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
      status: string;
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
  >(comment: T, mentions: string[] = []) {
    const { _count, ...rest } = comment;

    return {
      ...rest,

      // Preserve the thread when a parent comment is deleted or hidden,
      // but do not expose its old content.
      content:
        comment.deletedAt || comment.status === 'HIDDEN'
          ? null
          : comment.content,

      replyCount: _count?.replies ?? 0,

      mentions,
    };
  }
}
