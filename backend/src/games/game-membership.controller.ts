import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { GameMembershipService } from './game-membership.service';

/** Authenticated, session-scoped membership routes; no client userId is accepted. */
@ApiTags('Games')
@ApiCookieAuth('better-auth.session_token')
@Controller('games')
export class GameMembershipController {
  constructor(private readonly membership: GameMembershipService) {}

  /** Registered ahead of GamesController's dynamic :slug route. */
  @Get('joined')
  @ApiOperation({ summary: 'List your joined game communities' })
  list(@Session() session: UserSession | undefined) {
    return this.membership.list(session?.user.id);
  }

  /** Idempotently joins the game for the authenticated session user. */
  @Post(':gameSlug/join')
  @ApiOperation({ summary: 'Join a game community' })
  join(
    @Param('gameSlug') slug: string,
    @Session() session: UserSession | undefined,
  ) {
    return this.membership.join(slug, session?.user.id);
  }

  /** Idempotently removes the authenticated user's membership. */
  @Delete(':gameSlug/join')
  @ApiOperation({ summary: 'Leave a game community' })
  leave(
    @Param('gameSlug') slug: string,
    @Session() session: UserSession | undefined,
  ) {
    return this.membership.leave(slug, session?.user.id);
  }

  /** Returns only the authenticated user's joined state. */
  @Get(':gameSlug/join-status')
  @ApiOperation({ summary: 'Check your game community membership' })
  status(
    @Param('gameSlug') slug: string,
    @Session() session: UserSession | undefined,
  ) {
    return this.membership.status(slug, session?.user.id);
  }
}
