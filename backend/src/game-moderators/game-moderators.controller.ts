import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminGuard } from '../common/guards/admin.guard';
import { AssignGameModeratorDto } from './dto/assign-game-moderator.dto';
import { GameModeratorsService } from './game-moderators.service';

/**
 * Controller responsible for admin management of game moderators.
 *
 * These routes are admin-only because assigning/removing moderators changes
 * permission inside a game community.
 */
@Controller('games/:gameSlug/moderators')
@UseGuards(AdminGuard)
export class GameModeratorsController {
  constructor(private readonly gameModeratorsService: GameModeratorsService) {}

  /**
   * Lists all moderators of a game.
   *
   * Example:
   * GET /games/wuthering-waves/moderators
   */
  @Get()
  findByGameSlug(@Param('gameSlug') gameSlug: string) {
    return this.gameModeratorsService.findByGameSlug(gameSlug);
  }

  /**
   * Assigns a user as moderator of a game.
   *
   * Example:
   * POST /games/wuthering-waves/moderators
   *
   * Body:
   * {
   *   "email": "mod@example.com"
   * }
   *
   * or:
   * {
   *   "userId": "user_id_here"
   * }
   */
  @Post()
  assignModerator(
    @Param('gameSlug') gameSlug: string,
    @Body() dto: AssignGameModeratorDto,
    @Session() session: UserSession,
  ) {
    return this.gameModeratorsService.assignModerator(
      gameSlug,
      dto,
      session.user.id,
    );
  }

  /**
   * Removes a user from the moderator list of a game.
   *
   * Example:
   * DELETE /games/wuthering-waves/moderators/user_id_here
   */
  @Delete(':userId')
  removeModerator(
    @Param('gameSlug') gameSlug: string,
    @Param('userId') userId: string,
  ) {
    return this.gameModeratorsService.removeModerator(gameSlug, userId);
  }
}
