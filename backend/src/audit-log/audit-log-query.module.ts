import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { AdminAuditLogController } from './admin-audit-log.controller';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogQueryService } from './audit-log-query.service';
import { GameAuditLogController } from './game-audit-log.controller';

/** Read endpoints. Separate from AuditLogModule so GameModeratorsModule can record without a cycle. */
@Module({
  imports: [GameModeratorsModule, CommonModule],
  controllers: [GameAuditLogController, AdminAuditLogController],
  // Own repository instance: AuditLogModule deliberately exports only the write-side service.
  providers: [AuditLogQueryService, AuditLogRepository],
})
export class AuditLogQueryModule {}
