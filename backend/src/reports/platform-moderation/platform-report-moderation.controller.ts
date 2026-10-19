import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PlatformModeratorGuard } from '../../common/guards/platform-moderator.guard';
import { QueryPlatformReportsDto } from '../dto/platform-moderation/query-platform-reports.dto';
import { ReportModerationService } from '../moderation/report-moderation.service';

@ApiTags('Reports')
@ApiCookieAuth('better-auth.session_token')
@UseGuards(PlatformModeratorGuard)
@Controller('moderation/reports')
export class PlatformReportModerationController {
  constructor(
    private readonly reportModerationService: ReportModerationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the platform report queue. ADMIN / PLATFORM_MODERATOR only.',
    description:
      'Read-only, individual Report rows, not cases: several reports from one ModerationCase may appear. scope defaults to all; platform means ModerationCase.gameId = null (including deleted games); game requires gameSlug. gameSlug is rejected for other scopes. Uses existing legacy status compatibility and report pagination.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'],
  })
  @ApiQuery({ name: 'targetType', required: false, enum: ['POST', 'COMMENT'] })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: '1-500; default 1.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '1-100; default 20.',
  })
  @ApiOkResponse({
    description:
      'Paginated individual reports: items and meta (page, limit, total, totalPages). targetSnapshot is excluded.',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({
    description: 'Active ADMIN or PLATFORM_MODERATOR required.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid filters, pagination, or scope/gameSlug combination.',
  })
  @ApiNotFoundResponse({ description: 'Game slug does not exist.' })
  list(
    @Session() session: UserSession,
    @Query() query: QueryPlatformReportsDto,
  ) {
    return this.reportModerationService.listForPlatform(session.user.id, query);
  }
}
