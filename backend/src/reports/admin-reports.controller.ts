import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../common/guards/admin.guard';
import { QueryReportsAdminDto } from './dto/query-reports-admin.dto';
import { ReportModerationService } from './report-moderation.service';

/**
 * Cross-game report listing. Purely an admin action with no other
 * permission check inside it, so - unlike the game-scoped moderation
 * controller - a guard here duplicates nothing and is the right fit
 * (same pattern as GameModeratorsController).
 */
@ApiTags('Reports')
@ApiCookieAuth('better-auth.session_token')
@Controller('admin/reports')
@UseGuards(AdminGuard)
export class AdminReportsController {
  constructor(
    private readonly reportModerationService: ReportModerationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List reports across every game. Admin only.' })
  list(@Query() query: QueryReportsAdminDto) {
    return this.reportModerationService.listAllForAdmin(query);
  }
}
