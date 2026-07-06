import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { GamesController } from './games.controller';
import { GamesRepository } from './games.repository';
import { GamesService } from './games.service';

/**
 * GamesModule groups all game-related backend logic.
 *
 * It imports CommonModule so controller routes can use shared guards
 * such as AdminGuard.
 */
@Module({
  imports: [CommonModule],
  controllers: [GamesController],
  providers: [GamesService, GamesRepository],
  exports: [GamesService, GamesRepository],
})
export class GamesModule {}
