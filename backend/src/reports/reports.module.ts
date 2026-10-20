import { PlatformCaseModerationController } from './platform-moderation/platform-case-moderation.controller';
import { CommonModule } from '../common/common.module';
import { PlatformReportModerationController } from './platform-moderation/platform-report-moderation.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { Module } from '@nestjs/common';
import { PostVisibilityModule } from '../post-visibility/post-visibility.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { AdminReportsController } from './admin/admin-reports.controller';
import { ReportModerationController } from './game-moderation/report-moderation.controller';
import { ReportModerationService } from './moderation/report-moderation.service';
import { ReportRateLimiterService } from './infrastructure/report-rate-limiter.service';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    CommonModule,
    GameModeratorsModule,
    PostVisibilityModule,
    AuditLogModule,
  ],
  controllers: [
    ReportsController,
    PlatformReportModerationController,
    PlatformCaseModerationController,
    ReportModerationController,
    AdminReportsController,
  ],
  providers: [
    ReportsService,
    ReportModerationService,
    ReportsRepository,
    ReportRateLimiterService,
  ],
  exports: [ReportsRepository],
})
export class ReportsModule {}
