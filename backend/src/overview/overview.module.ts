import { Module } from '@nestjs/common';
import { AuditLogQueryModule } from '../audit-log/audit-log-query.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { GamesModule } from '../games/games.module';
import { ReportsModule } from '../reports/reports.module';
import { UsersModule } from '../users/users.module';
import { AdminOverviewController } from './admin-overview.controller';
import { OverviewService } from './overview.service';

@Module({
  imports: [
    UsersModule,
    GamesModule,
    ReportsModule,
    GameModeratorsModule,
    AuditLogQueryModule,
  ],
  controllers: [AdminOverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
