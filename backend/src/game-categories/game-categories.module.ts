import { Module } from '@nestjs/common';
import { GamesModule } from '../games/games.module';
import { GameCategoriesController } from './game-categories.controller';
import { GameCategoriesRepository } from './game-categories.repository';
import { GameCategoriesService } from './game-categories.service';

/**
 * GameCategoriesModule groups all category logic.
 *
 * It imports GamesModule because category logic needs to check
 * whether a game exists before creating/listing categories.
 */
@Module({
  imports: [GamesModule],
  controllers: [GameCategoriesController],
  providers: [GameCategoriesService, GameCategoriesRepository],
  exports: [GameCategoriesService, GameCategoriesRepository],
})
export class GameCategoriesModule {}
