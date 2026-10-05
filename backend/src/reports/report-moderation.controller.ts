import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { QueryReportsDto } from './dto/query-reports.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { ReportModerationService } from './report-moderation.service';

/**
 * Moderator/admin actions on reports, scoped to the game they belong to.
 * No guard here for the same reason as PostModerationController: the
 * service already has to resolve the gameSlug and cross-check it against
 * the report's own gameId, so a guard in front would repeat that lookup
 * before the route even runs.
 */
@ApiTags('Reports')
@Controller('games/:gameSlug/reports')
export class ReportModerationController {
  constructor(
    private readonly reportModerationService: ReportModerationService,
  ) {}

  @Get()
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'List reports for this game. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  list(
    @Param('gameSlug') gameSlug: string,
    @Query() query: QueryReportsDto,
    @Session() session: UserSession,
  ) {
    return this.reportModerationService.listForModerator(
      gameSlug,
      session.user.id,
      query,
    );
  }

  @Patch(':reportId/claim')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Claim a pending report. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  @ApiParam({ name: 'reportId', example: 'cm123abc456' })
  claim(
    @Param('gameSlug') gameSlug: string,
    @Param('reportId') reportId: string,
    @Session() session: UserSession,
  ) {
    return this.reportModerationService.claim(
      gameSlug,
      reportId,
      session.user.id,
    );
  }

  @Patch(':reportId/resolve')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Resolve a report. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  @ApiParam({ name: 'reportId', example: 'cm123abc456' })
  resolve(
    @Param('gameSlug') gameSlug: string,
    @Param('reportId') reportId: string,
    @Body() dto: ResolveReportDto,
    @Session() session: UserSession,
  ) {
    return this.reportModerationService.resolve(
      gameSlug,
      reportId,
      session.user.id,
      dto,
    );
  }

  @Patch(':reportId/dismiss')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Dismiss a report. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  @ApiParam({ name: 'reportId', example: 'cm123abc456' })
  dismiss(
    @Param('gameSlug') gameSlug: string,
    @Param('reportId') reportId: string,
    @Body() dto: ResolveReportDto,
    @Session() session: UserSession,
  ) {
    return this.reportModerationService.dismiss(
      gameSlug,
      reportId,
      session.user.id,
      dto,
    );
  }
}
