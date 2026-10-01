import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../common/guards/admin.guard';
import { OverviewService } from './overview.service';

@ApiTags('Overview')
@ApiCookieAuth('better-auth.session_token')
@Controller('admin/overview')
@UseGuards(AdminGuard)
export class AdminOverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get()
  @ApiOperation({
    summary:
      'Platform-wide counts, top communities, and recent moderation activity. Admin only.',
  })
  getOverview() {
    return this.overviewService.getOverview();
  }
}
