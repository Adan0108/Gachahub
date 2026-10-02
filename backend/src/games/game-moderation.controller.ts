import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminGuard } from '../common/guards/admin.guard';
import { FlagGameDto } from './dto/flag-game.dto';
import { UpdateGameBrandingDto } from './dto/update-game-branding.dto';
import { GameModerationService } from './game-moderation.service';

// No class-level guard: branding/flag are admin-or-moderator (checked in the service), archive/restore are admin-only via their own AdminGuard.
@ApiTags('Games')
@Controller('games/:gameSlug')
export class GameModerationController {
  constructor(private readonly gameModerationService: GameModerationService) {}

  @Patch('branding')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary:
      'Replace a game icon/banner with a confirmed upload. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  updateBranding(
    @Param('gameSlug') gameSlug: string,
    @Body() dto: UpdateGameBrandingDto,
    @Session() session: UserSession,
  ) {
    return this.gameModerationService.updateBranding(
      gameSlug,
      session.user.id,
      dto,
    );
  }

  @Post('flag')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary:
      'Flag a game for admin review, no status change. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  flag(
    @Param('gameSlug') gameSlug: string,
    @Body() dto: FlagGameDto,
    @Session() session: UserSession,
  ) {
    return this.gameModerationService.flagForReview(
      gameSlug,
      session.user.id,
      dto,
    );
  }

  @Patch('archive')
  @UseGuards(AdminGuard)
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Soft-delete a game. Admin only.' })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  archive(
    @Param('gameSlug') gameSlug: string,
    @Session() session: UserSession,
  ) {
    return this.gameModerationService.archive(gameSlug, session.user.id);
  }

  @Patch('restore')
  @UseGuards(AdminGuard)
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Restore an archived game. Admin only.' })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  restore(
    @Param('gameSlug') gameSlug: string,
    @Session() session: UserSession,
  ) {
    return this.gameModerationService.restore(gameSlug, session.user.id);
  }
}
