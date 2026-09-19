import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../common/guards/admin.guard';
import { AuditLogQueryService } from './audit-log-query.service';
import { QueryAuditLogsAdminDto } from './dto/query-audit-logs-admin.dto';

@ApiTags('Audit Log')
@ApiCookieAuth('better-auth.session_token')
@Controller('admin/audit-logs')
@UseGuards(AdminGuard)
export class AdminAuditLogController {
  constructor(private readonly auditLogQueryService: AuditLogQueryService) {}

  @Get()
  @ApiOperation({
    summary: 'List audit entries across every game. Admin only.',
  })
  list(@Query() query: QueryAuditLogsAdminDto) {
    return this.auditLogQueryService.listAllForAdmin(query);
  }
}
