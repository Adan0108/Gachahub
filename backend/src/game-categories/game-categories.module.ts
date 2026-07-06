import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { GamesModule } from '../games/games.module';
import { GameCategoriesController } from './game-categories.controller';
import { GameCategoriesRepository } from './game-categories.repository';
import { GameCategoriesService } from './game-categories.service';

/**
 * GameCategoriesModule groups all category logic.
 *
 * It imports:
 * - GamesModule because categories need game lookup logic
 * - CommonModule because admin-only routes use AdminGuard
 */
@Module({
  imports: [GamesModule, CommonModule],
  controllers: [GameCategoriesController],
  providers: [GameCategoriesService, GameCategoriesRepository],
  exports: [GameCategoriesService, GameCategoriesRepository],
})
export class GameCategoriesModule {}
