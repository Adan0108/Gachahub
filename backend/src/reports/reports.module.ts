import { PlatformCaseModerationController } from './platform-moderation/platform-case-moderation.controller';
import { CommonModule } from '../common/common.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { Module } from '@nestjs/common';
import { PostVisibilityModule } from '../post-visibility/post-visibility.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { GameCaseModerationController } from './game-moderation/game-case-moderation.controller';
import { ReportModerationService } from './moderation/report-moderation.service';
import { ReportRateLimiterService } from './infrastructure/report-rate-limiter.service';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { ModerationAnalysisScheduler } from '../moderation-analysis/moderation-analysis-scheduler.service';

@Module({
  imports: [
    DomainEventsModule,
    CommonModule,
    GameModeratorsModule,
    PostVisibilityModule,
    AuditLogModule,
  ],
  controllers: [
    ReportsController,
    PlatformCaseModerationController,
    GameCaseModerationController,
  ],
  providers: [
    ModerationAnalysisScheduler,
    ReportsService,
    ReportModerationService,
    ReportsRepository,
    ReportRateLimiterService,
  ],
  exports: [ReportsRepository],
})
export class ReportsModule {}
