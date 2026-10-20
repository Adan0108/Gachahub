import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

/**
 * Filing a report. Split from the moderation queue controller since this
 * route has a completely different authorization model - any active user,
 * not "admin or moderator of this game".
 */
@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'File a complaint/evidence against a visible post or comment',
    description:
      'Creates/reuses an active ModerationCase. Report is evidence only; use caseId with moderation case APIs for workflow.',
  })
  @ApiCreatedResponse({
    description:
      'Complaint receipt: id, caseId, reporterId, targetType, targetId, reasonCode, details, createdAt. No workflow status, assignment, resolution, synthetic game fields or raw targetSnapshot.',
  })
  create(@Body() dto: CreateReportDto, @Session() session: UserSession) {
    return this.reportsService.create(session.user.id, dto);
  }
}
