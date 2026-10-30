import { Optional } from '@nestjs/common';
import { EnforcementService } from '../../moderation-enforcement/enforcement.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { loadActiveUser } from '../../common/guards/active-user.util';
import { PostStatus } from '../../generated/prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import type { PostAuditAction } from '../../audit-log/audit-log.types';
import { GameModeratorsService } from '../../game-moderators/game-moderators.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { formatPost } from '../post.mapper';
import { PostsRepository } from '../posts.repository';
import { resolvePagination, toPaginated } from '../../common/utils/paginated';

/**
 * Moderator/admin actions on posts: hide, restore, and list what's hidden
 * in a game. Split out of PostsService because these routes use a
 * completely different authorization model (game-moderator, not "must be
 * the author") and only ever need postsRepository + gameModeratorsService,
 * never media, follows, or interests.
 */
@Injectable()
export class PostModerationService {
  constructor(
    private readonly postsRepository: PostsRepository,
    private readonly gameModeratorsService: GameModeratorsService,
    private readonly auditLogService: AuditLogService,
    private readonly prisma: PrismaService,
    @Optional() private readonly enforcement?: EnforcementService,
  ) {}

  async hideAsModerator(gameSlug: string, postId: string, moderatorId: string) {
    return this.setModeratedStatus({
      gameSlug,
      postId,
      moderatorId,
      from: PostStatus.PUBLISHED,
      to: PostStatus.HIDDEN,
      auditAction: 'POST_HIDDEN',
      rejectionMessage: 'Only published posts can be hidden',
    });
  }

  async restoreAsModerator(
    gameSlug: string,
    postId: string,
    moderatorId: string,
  ) {
    return this.setModeratedStatus({
      gameSlug,
      postId,
      moderatorId,
      from: PostStatus.HIDDEN,
      to: PostStatus.PUBLISHED,
      auditAction: 'POST_RESTORED',
      rejectionMessage: 'Only hidden posts can be restored',
    });
  }

  async setPersonalStatus(
    postId: string,
    moderatorId: string,
    hidden: boolean,
  ) {
    return this.setModeratedStatus({
      postId,
      moderatorId,
      from: hidden ? PostStatus.PUBLISHED : PostStatus.HIDDEN,
      to: hidden ? PostStatus.HIDDEN : PostStatus.PUBLISHED,
      auditAction: hidden ? 'POST_HIDDEN' : 'POST_RESTORED',
      rejectionMessage: hidden
        ? 'Only published posts can be hidden'
        : 'Only hidden posts can be restored',
    });
  }

  /**
   * Lists posts a moderator has hidden in their game, since a moderator
   * cannot otherwise view a post they hid (PostsService.findOne only allows
   * the author or PUBLISHED posts through) - without this there is no way
   * to discover a postId to pass to restoreAsModerator.
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

    const result = await this.postsRepository.findHiddenByGame(gameId, {
      page,
      limit,
    });

    return toPaginated(
      result.items.map((post) => formatPost(post)),
      { page, limit, total: result.total },
    );
  }

  /**
   * Admin or an assigned moderator of the post's own game only - the shared
   * preamble in GameModeratorsService.loadModeratableResource resolves the
   * route's gameSlug, authorizes the caller, then cross-checks the post's own
   * gameId, so a moderator of one game can't hide a post in another just by
   * swapping the URL. `from`/`to` collapse hide and restore into one implementation;
   * they're each other's inverse. Takes a single options object rather than
   * positional args since `from`/`to` are the same type and adjacent -
   * transposing them would silently invert hide into restore.
   *
   * The status write and the audit entry commit together (recordOrThrow
   * inside the same $transaction) - same reasoning as
   * UserModerationService.setStatus: a moderation action can't land with no
   * record of who did it.
   */
  private async setModeratedStatus(params: {
    gameSlug?: string;
    postId: string;
    moderatorId: string;
    from: PostStatus;
    to: PostStatus;
    auditAction: PostAuditAction;
    rejectionMessage: string;
  }) {
    if (this.enforcement) {
      await this.enforcement.content(
        params.moderatorId,
        'POST',
        params.postId,
        params.to === 'HIDDEN',
        params.to === 'HIDDEN'
          ? 'Content hidden by moderator'
          : 'Content restored by moderator',
        params.gameSlug,
      );
      const post = await this.postsRepository.findById(params.postId);
      if (!post) throw new NotFoundException('Post not found');
      return formatPost(post);
    }
    const {
      gameSlug,
      postId,
      moderatorId,
      from,
      to,
      auditAction,
      rejectionMessage,
    } = params;

    const { gameId, post } = await this.loadForModeration(
      gameSlug,
      postId,
      moderatorId,
    );

    if (post.status === to) {
      return formatPost(post);
    }

    if (post.status !== from) {
      throw new BadRequestException(rejectionMessage);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.postsRepository.transitionStatus(tx, {
        id: postId,
        gameId,
        from,
        to,
      });

      if (!result) {
        // The post moved off `from` between our read above and this write -
        // another moderator (or the author) beat us to it.
        throw new ConflictException(
          'This post was changed by someone else - please retry',
        );
      }

      await this.auditLogService.recordOrThrow(
        {
          action: auditAction,
          actorId: moderatorId,
          targetType: 'POST',
          targetId: postId,
          gameId: gameId ?? undefined,
          gameSlug,
          metadata: { authorId: post.authorId, postTitle: post.title },
        },
        tx,
      );

      return result;
    });

    return formatPost(updated);
  }

  private async loadForModeration(
    gameSlug: string | undefined,
    postId: string,
    moderatorId: string,
  ) {
    if (gameSlug !== undefined) {
      const result = await this.gameModeratorsService.loadModeratableResource({
        gameSlug,
        moderatorId,
        notFoundMessage: 'Post not found',
        load: async () => {
          const post = await this.findLivePost(postId);
          return post && post.gameId !== null
            ? { ...post, gameId: post.gameId }
            : null;
        },
      });
      return { gameId: result.gameId, post: result.resource };
    }
    const user = await loadActiveUser(this.prisma, moderatorId);
    if (user.role !== 'ADMIN')
      throw new ForbiddenException('Admin permission required');
    const post = await this.findLivePost(postId);
    if (!post || post.gameId !== null)
      throw new NotFoundException('Personal post not found');
    return { gameId: null, post };
  }

  /**
   * A post that's soft-deleted is not moderatable - null tells
   * GameModeratorsService.loadModeratableResource to report it as not found.
   */
  private async findLivePost(postId: string) {
    const post = await this.postsRepository.findById(postId);

    return post && !post.deletedAt && post.status !== PostStatus.DELETED
      ? post
      : null;
  }
}
