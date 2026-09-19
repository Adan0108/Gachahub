import { AuditLogModule } from '../audit-log/audit-log.module';
import { Module } from '@nestjs/common';
import { PostVisibilityModule } from '../post-visibility/post-visibility.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { AdminReportsController } from './admin-reports.controller';
import { ReportModerationController } from './report-moderation.controller';
import { ReportModerationService } from './report-moderation.service';
import { ReportRateLimiterService } from './report-rate-limiter.service';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

@Module({
  imports: [GameModeratorsModule, PostVisibilityModule, AuditLogModule],
  controllers: [
    ReportsController,
    ReportModerationController,
    AdminReportsController,
  ],
  providers: [
    ReportsService,
    ReportModerationService,
    ReportsRepository,
    ReportRateLimiterService,
  ],
})
export class ReportsModule {}
