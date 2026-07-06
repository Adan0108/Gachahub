import { Module } from '@nestjs/common';
import { GamesController } from './games.controller';
import { GamesRepository } from './games.repository';
import { GamesService } from './games.service';

/**
 * GamesModule groups all game-related backend logic.
 *
 * It exports GamesRepository and GamesService so other modules
 * such as GameCategoriesModule, PostsModule, BuildsModule, and TeamsModule
 * can reuse game lookup logic.
 */
@Module({
  controllers: [GamesController],
  providers: [GamesService, GamesRepository],
  exports: [GamesService, GamesRepository],
})
export class GamesModule {}
