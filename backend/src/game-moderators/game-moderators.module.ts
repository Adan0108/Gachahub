import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { GameModeratorsController } from './game-moderators.controller';
import { GameModeratorsRepository } from './game-moderators.repository';
import { GameModeratorsService } from './game-moderators.service';

/**
 * GameModeratorsModule handles admin management of game moderators.
 *
 * It allows admins to:
 * - list moderators of a game
 * - assign a moderator to a game
 * - remove a moderator from a game
 */
@Module({
  imports: [CommonModule],
  controllers: [GameModeratorsController],
  providers: [GameModeratorsService, GameModeratorsRepository],
  exports: [GameModeratorsService, GameModeratorsRepository],
})
export class GameModeratorsModule {}
