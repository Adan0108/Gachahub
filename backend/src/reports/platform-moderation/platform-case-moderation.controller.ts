import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PlatformModeratorGuard } from '../../common/guards/platform-moderator.guard';
import { QueryPlatformCasesDto } from '../dto/platform-moderation/query-platform-cases.dto';
import { QueryCaseReportsDto } from '../dto/platform-moderation/query-case-reports.dto';
import { ReportModerationService } from '../moderation/report-moderation.service';

@ApiTags('Moderation cases')
@ApiCookieAuth('better-auth.session_token')
@UseGuards(PlatformModeratorGuard)
@ApiUnauthorizedResponse({ description: 'Authentication required.' })
@ApiForbiddenResponse({
  description:
    'Live, active ADMIN or PLATFORM_MODERATOR required. GameModerator assignment alone is insufficient.',
})
@ApiBadRequestResponse({
  description: 'Invalid query, scope/gameSlug combination, or evidence cursor.',
})
@Controller('moderation/cases')
export class PlatformCaseModerationController {
  constructor(
    private readonly reportModerationService: ReportModerationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List moderation cases. ADMIN / PLATFORM_MODERATOR only.',
    description:
      'One row per ModerationCase; multiple user Reports are evidence inside that case. Native statuses: OPEN, IN_REVIEW, RESOLVED, DISMISSED. scope defaults to all; platform filters gameId=null (also deleted games); game requires gameSlug. Other scopes reject gameSlug. Omitted status includes all statuses. Ordered createdAt DESC, id DESC; page defaults 1 (max 500), limit defaults 20 (max 100). Counts are stored case aggregates and may exceed surviving evidence after reporter deletion.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', default: 1, minimum: 1, maximum: 500 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
  })
  @ApiOkResponse({
    description:
      'items: case id, targetType, targetId, gameId/game, native status, reportCount, uniqueReporterCount, currentRiskScore/currentRiskLevel, assignedModeratorId/assignedModerator, resolvedById/resolvedBy, resolvedAt, createdAt, updatedAt. User summaries contain id/name/image; game contains id/name/slug. No reports, snapshot, target body or resolutionNote. meta: page, limit, total CASES, totalPages.',
  })
  @ApiNotFoundResponse({ description: 'Unknown gameSlug.' })
  list(@Session() session: UserSession, @Query() query: QueryPlatformCasesDto) {
    return this.reportModerationService.listCasesForPlatform(
      session.user.id,
      query,
    );
  }

  @Get(':caseId')
  @ApiParam({
    name: 'caseId',
    description: 'ModerationCase ID, not Report ID.',
  })
  @ApiOperation({
    summary:
      'Read a moderation case with current target and first evidence page.',
    description:
      'ADMIN / PLATFORM_MODERATOR only. Includes resolutionNote and all list fields. targetState is available, deleted or missing; a missing target gives target=null while case/evidence remain readable. Current target is distinct from historical per-Report snapshot evidence. First evidence page is limited to 20, ordered createdAt DESC, id DESC. Stored counters are not recomputed on reads.',
  })
  @ApiOkResponse({
    description:
      'Case detail plus target (explicit POST/COMMENT projection), targetState, and evidence { items, nextCursor }. Evidence items: id, reporter {id,name,image}, reasonCode, details, createdAt, snapshot|null. Snapshot version 1 allowlists targetType/targetId, authorId, content, title, status, visibility, postId, parentId and up to 20 media entries (url/mediaType/altText). Unknown/malformed snapshots are null. Raw targetSnapshot JSON and storage identifiers are excluded. Follow nextCursor using GET /moderation/cases/:caseId/reports.',
  })
  @ApiNotFoundResponse({
    description:
      'Moderation case does not exist. Missing target content does not produce 404.',
  })
  detail(@Session() session: UserSession, @Param('caseId') caseId: string) {
    return this.reportModerationService.getCaseForPlatform(
      session.user.id,
      caseId,
    );
  }

  @Get(':caseId/reports')
  @ApiParam({ name: 'caseId', description: 'ModerationCase ID.' })
  @ApiOperation({
    summary: 'Read another bounded page of case evidence.',
    description:
      'ADMIN / PLATFORM_MODERATOR only. limit defaults to 20, maximum 100. Use the opaque nextCursor returned by detail or the previous page. Pagination uses the exclusive (createdAt,id) descending boundary and always scopes evidence to caseId. A cursor remains usable if its original Report is deleted.',
  })
  @ApiOkResponse({
    description:
      '{ items, nextCursor }: same explicit evidence projection as detail. nextCursor is null at the end. Empty cases return items=[]. No workflow mutation or raw targetSnapshot field.',
  })
  @ApiNotFoundResponse({ description: 'Moderation case does not exist.' })
  reports(
    @Session() session: UserSession,
    @Param('caseId') caseId: string,
    @Query() query: QueryCaseReportsDto,
  ) {
    return this.reportModerationService.listCaseReportsForPlatform(
      session.user.id,
      caseId,
      query,
    );
  }
}
