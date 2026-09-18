import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PostModerationService } from './post-moderation.service';

/**
 * Moderator/admin actions on posts, scoped to the game they belong to.
 * Split from PostsController since these routes use a different
 * authorization model ("admin or moderator of this game", not "must be the
 * post's author"). No GameModeratorGuard here - PostModerationService
 * already runs the same admin-or-moderator check itself (it has to, since
 * it's the only layer that can cross-check the post's own gameId against
 * the route), so a guard in front of it would just repeat the same three
 * queries a second time before the post is even fetched.
 */
@ApiTags('Posts')
@Controller('games/:gameSlug/posts')
export class PostModerationController {
  constructor(private readonly postModerationService: PostModerationService) {}

  @Get('hidden')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'List posts hidden in this game. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  listHidden(
    @Param('gameSlug') gameSlug: string,
    @Query() query: PaginationQueryDto,
    @Session() session: UserSession,
  ) {
    return this.postModerationService.listHiddenForModerator(
      gameSlug,
      session.user.id,
      query,
    );
  }

  @Patch(':postId/hide')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Hide a post. Admin or game moderator only.' })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  @ApiParam({ name: 'postId', example: 'cm123abc456' })
  hide(
    @Param('gameSlug') gameSlug: string,
    @Param('postId') postId: string,
    @Session() session: UserSession,
  ) {
    return this.postModerationService.hideAsModerator(
      gameSlug,
      postId,
      session.user.id,
    );
  }

  @Patch(':postId/restore')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Restore a hidden post. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  @ApiParam({ name: 'postId', example: 'cm123abc456' })
  restore(
    @Param('gameSlug') gameSlug: string,
    @Param('postId') postId: string,
    @Session() session: UserSession,
  ) {
    return this.postModerationService.restoreAsModerator(
      gameSlug,
      postId,
      session.user.id,
    );
  }
}
