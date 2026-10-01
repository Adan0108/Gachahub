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
import { CommentModerationService } from './comment-moderation.service';

/**
 * Moderator/admin actions on comments, scoped to the game they belong to -
 * mirrors PostModerationController. No guard here for the same reason: the
 * service has to resolve the gameSlug and cross-check it against the
 * comment's own post.gameId, so a guard in front would repeat that lookup
 * before the route even runs.
 */
@ApiTags('Comments')
@Controller('games/:gameSlug/comments')
export class CommentModerationController {
  constructor(
    private readonly commentModerationService: CommentModerationService,
  ) {}

  @Get('hidden')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'List comments hidden in this game. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  listHidden(
    @Param('gameSlug') gameSlug: string,
    @Query() query: PaginationQueryDto,
    @Session() session: UserSession,
  ) {
    return this.commentModerationService.listHiddenForModerator(
      gameSlug,
      session.user.id,
      query,
    );
  }

  @Patch(':commentId/hide')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Hide a comment. Admin or game moderator only.' })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  @ApiParam({ name: 'commentId', example: 'cmcomment123' })
  hide(
    @Param('gameSlug') gameSlug: string,
    @Param('commentId') commentId: string,
    @Session() session: UserSession,
  ) {
    return this.commentModerationService.hideAsModerator(
      gameSlug,
      commentId,
      session.user.id,
    );
  }

  @Patch(':commentId/restore')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Restore a hidden comment. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  @ApiParam({ name: 'commentId', example: 'cmcomment123' })
  restore(
    @Param('gameSlug') gameSlug: string,
    @Param('commentId') commentId: string,
    @Session() session: UserSession,
  ) {
    return this.commentModerationService.restoreAsModerator(
      gameSlug,
      commentId,
      session.user.id,
    );
  }
}
