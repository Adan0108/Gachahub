import { Module } from '@nestjs/common';
import { AdminGuard } from './guards/admin.guard';
import { GameModeratorGuard } from './guards/game-moderator.guard';

/**
 * CommonModule contains shared reusable providers.
 *
 * Guards, interceptors, filters, and shared helpers that need dependency
 * injection should be registered here and exported to feature modules.
 */
@Module({
  providers: [AdminGuard, GameModeratorGuard],
  exports: [AdminGuard, GameModeratorGuard],
})
export class CommonModule {}
