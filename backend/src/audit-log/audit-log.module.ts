import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';

/** Recording only - import this from any module that performs auditable actions. */
@Module({
  imports: [CommonModule],
  providers: [AuditLogService, AuditLogRepository],
  exports: [AuditLogService],
})
export class AuditLogModule {}
