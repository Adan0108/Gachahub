import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { AssignGameModeratorDto } from './dto/assign-game-moderator.dto';
import { GameModeratorsService } from './game-moderators.service';

/**
 * Controller responsible for admin management of game moderators.
 *
 * These routes are admin-only because assigning/removing moderators changes
 * permission inside a game community.
 */
@ApiTags('Game Moderators')
@ApiCookieAuth('better-auth.session_token')
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
  @ApiOperation({ summary: 'List game moderators. Admin only.' })
  @ApiParam({
    name: 'gameSlug',
    example: 'wuthering-waves',
  })
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
  @ApiOperation({ summary: 'Assign a game moderator. Admin only.' })
  @ApiParam({
    name: 'gameSlug',
    example: 'wuthering-waves',
  })
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
  @ApiOperation({ summary: 'Remove a game moderator. Admin only.' })
  @ApiParam({
    name: 'gameSlug',
    example: 'wuthering-waves',
  })
  @ApiParam({
    name: 'userId',
    example: 'cm123abc456',
  })
  removeModerator(
    @Param('gameSlug') gameSlug: string,
    @Param('userId') userId: string,
  ) {
    return this.gameModeratorsService.removeModerator(gameSlug, userId);
  }
}
