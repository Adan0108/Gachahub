import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PostStatus } from '../generated/prisma/client';
import { GameModeratorsService } from '../game-moderators/game-moderators.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatPost } from './post.mapper';
import { PostsRepository } from './posts.repository';

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
  ) {}

  async hideAsModerator(gameSlug: string, postId: string, moderatorId: string) {
    return this.setModeratedStatus({
      gameSlug,
      postId,
      moderatorId,
      from: PostStatus.PUBLISHED,
      to: PostStatus.HIDDEN,
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
      rejectionMessage: 'Only hidden posts can be restored',
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

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const result = await this.postsRepository.findHiddenByGame(gameId, {
      page,
      limit,
    });

    return {
      items: result.items.map((post) => formatPost(post)),
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
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
   */
  private async setModeratedStatus(params: {
    gameSlug: string;
    postId: string;
    moderatorId: string;
    from: PostStatus;
    to: PostStatus;
    rejectionMessage: string;
  }) {
    const { gameSlug, postId, moderatorId, from, to, rejectionMessage } =
      params;

    const { gameId, resource: post } =
      await this.gameModeratorsService.loadModeratableResource({
        gameSlug,
        moderatorId,
        notFoundMessage: 'Post not found',
        load: () => this.findLivePost(postId),
      });

    if (post.status === to) {
      return formatPost(post);
    }

    if (post.status !== from) {
      throw new BadRequestException(rejectionMessage);
    }

    const updated = await this.postsRepository.transitionStatus({
      id: postId,
      gameId,
      from,
      to,
    });

    if (!updated) {
      // The post moved off `from` between our read above and this write -
      // another moderator (or the author) beat us to it.
      throw new ConflictException(
        'This post was changed by someone else - please retry',
      );
    }

    return formatPost(updated);
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
