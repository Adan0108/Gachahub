import { Optional } from '@nestjs/common';
import { EnforcementService } from '../moderation-enforcement/enforcement.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { loadActiveUser } from '../common/guards/active-user.util';
import { CommentStatus } from '../generated/prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { CommentAuditAction } from '../audit-log/audit-log.types';
import { GameModeratorsService } from '../game-moderators/game-moderators.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CommentsRepository } from './comments.repository';
import { resolvePagination, toPaginated } from '../common/utils/paginated';

/**
 * Moderator/admin actions on comments: hide, restore, and list what's hidden
 * in a game. Mirrors PostModerationService, but a comment has no gameId of
 * its own (unlike Post) - it only reaches a game through post.gameId - so
 * the authorize-then-load-then-cross-check preamble is written out here
 * instead of reusing GameModeratorsService.loadModeratableResource, which
 * requires the resource to carry gameId directly.
 *
 * The status write and the audit entry commit together (recordOrThrow
 * inside the same $transaction) - same reasoning as
 * UserModerationService.setStatus: a moderation action can't land with no
 * record of who did it.
 */
@Injectable()
export class CommentModerationService {
  constructor(
    private readonly commentsRepository: CommentsRepository,
    private readonly gameModeratorsService: GameModeratorsService,
    private readonly auditLogService: AuditLogService,
    private readonly prisma: PrismaService,
    @Optional() private readonly enforcement?: EnforcementService,
  ) {}

  async hideAsModerator(
    gameSlug: string,
    commentId: string,
    moderatorId: string,
  ) {
    return this.setModeratedStatus({
      gameSlug,
      commentId,
      moderatorId,
      from: CommentStatus.PUBLISHED,
      to: CommentStatus.HIDDEN,
      auditAction: 'COMMENT_HIDDEN',
      rejectionMessage: 'Only published comments can be hidden',
    });
  }

  async restoreAsModerator(
    gameSlug: string,
    commentId: string,
    moderatorId: string,
  ) {
    return this.setModeratedStatus({
      gameSlug,
      commentId,
      moderatorId,
      from: CommentStatus.HIDDEN,
      to: CommentStatus.PUBLISHED,
      auditAction: 'COMMENT_RESTORED',
      rejectionMessage: 'Only hidden comments can be restored',
    });
  }

  async setPersonalStatus(
    commentId: string,
    moderatorId: string,
    hidden: boolean,
  ) {
    return this.setModeratedStatus({
      commentId,
      moderatorId,
      from: hidden ? CommentStatus.PUBLISHED : CommentStatus.HIDDEN,
      to: hidden ? CommentStatus.HIDDEN : CommentStatus.PUBLISHED,
      auditAction: hidden ? 'COMMENT_HIDDEN' : 'COMMENT_RESTORED',
      rejectionMessage: hidden
        ? 'Only published comments can be hidden'
        : 'Only hidden comments can be restored',
    });
  }

  /**
   * Lists comments a moderator has hidden in their game - without this
   * there is no way to discover a commentId to pass to restoreAsModerator,
   * same bootstrapping problem PostModerationService.listHiddenForModerator
   * solves for posts.
   */
  async listHiddenForModerator(
    gameSlug: string,
    moderatorId: string,
    query: PaginationQueryDto,
  ) {
    const gameId = await this.gameModeratorsService.resolveModeratableGameId(
      gameSlug,
      moderatorId,
    );

    const { page, limit } = resolvePagination(query);

    const result = await this.commentsRepository.findHiddenByGame(gameId, {
      page,
      limit,
    });

    return toPaginated(result.items, { page, limit, total: result.total });
  }

  private async setModeratedStatus(params: {
    gameSlug?: string;
    commentId: string;
    moderatorId: string;
    from: CommentStatus;
    to: CommentStatus;
    auditAction: CommentAuditAction;
    rejectionMessage: string;
  }) {
    if (this.enforcement) {
      await this.enforcement.content(
        params.moderatorId,
        'COMMENT',
        params.commentId,
        params.to === 'HIDDEN',
        params.to === 'HIDDEN'
          ? 'Content hidden by moderator'
          : 'Content restored by moderator',
        params.gameSlug,
      );
      const comment = await this.commentsRepository.findByIdForModeration(
        params.commentId,
      );
      if (!comment) throw new NotFoundException('Comment not found');
      const { post, ...rest } = comment;
      return { ...rest, postId: post.id };
    }
    const {
      gameSlug,
      commentId,
      moderatorId,
      from,
      to,
      auditAction,
      rejectionMessage,
    } = params;

    let gameId: string | null;
    if (gameSlug !== undefined) {
      gameId = await this.gameModeratorsService.resolveModeratableGameId(
        gameSlug,
        moderatorId,
      );
    } else {
      const user = await loadActiveUser(this.prisma, moderatorId);
      if (user.role !== 'ADMIN')
        throw new ForbiddenException('Admin permission required');
      gameId = null;
    }

    const comment =
      await this.commentsRepository.findByIdForModeration(commentId);

    if (!comment || comment.deletedAt || comment.post.gameId !== gameId) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.status === to) {
      const { post, ...rest } = comment;
      return { ...rest, postId: post.id };
    }

    if (comment.status !== from) {
      throw new BadRequestException(rejectionMessage);
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.commentsRepository.transitionStatus(tx, {
        id: commentId,
        postId: comment.post.id,
        from,
        to,
      });

      if (!result) {
        // The comment moved off `from` between our read above and this
        // write - another moderator beat us to it.
        throw new ConflictException(
          'This comment was changed by someone else - please retry',
        );
      }

      await this.auditLogService.recordOrThrow(
        {
          action: auditAction,
          actorId: moderatorId,
          targetType: 'COMMENT',
          targetId: commentId,
          gameId: gameId ?? undefined,
          gameSlug,
          metadata: { authorId: comment.authorId, postId: comment.post.id },
        },
        tx,
      );

      return result;
    });
  }
}
