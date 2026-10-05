import { GameMembershipController } from './game-membership.controller';
import { GameMembershipService } from './game-membership.service';
import { GameMembershipRepository } from './game-membership.repository';
import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CommonModule } from '../common/common.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { MediaModule } from '../media/media.module';
import { GameModerationController } from './game-moderation.controller';
import { GameModerationService } from './game-moderation.service';
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
  imports: [CommonModule, GameModeratorsModule, MediaModule, AuditLogModule],
  controllers: [
    GameMembershipController,
    GamesController,
    GameModerationController,
  ],
  providers: [
    GamesService,
    GamesRepository,
    GameModerationService,
    GameMembershipService,
    GameMembershipRepository,
  ],
  exports: [GamesService, GamesRepository],
})
export class GamesModule {}
