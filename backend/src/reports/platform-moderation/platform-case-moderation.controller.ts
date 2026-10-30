import { AI_ADVISORY_DESCRIPTION } from '../domain/ai-advisory';
import { AssignCaseDto } from '../dto/assign-case.dto';
import { QueryCaseAssigneesDto } from '../dto/query-case-assignees.dto';
import { ResolveModerationCaseDto } from '../dto/resolve-moderation-case.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiConflictResponse,
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
import { QueryCaseReportsDto } from '../dto/query-case-reports.dto';
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
  description:
    'Invalid query, scope/gameSlug combination, or case/evidence cursor.',
})
@Controller('moderation/cases')
export class PlatformCaseModerationController {
  constructor(
    private readonly reportModerationService: ReportModerationService,
  ) {}

  @Get()
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description:
      'Opaque nextCursor from the previous queue response; omit for the first page.',
  })
  @ApiOperation({
    summary: 'List moderation cases. ADMIN / PLATFORM_MODERATOR only.',
    description:
      'One row per ModerationCase; multiple user Reports are evidence inside that case. Native statuses: OPEN, IN_REVIEW, RESOLVED, DISMISSED. scope defaults to all; platform filters gameId=null (also deleted games); game requires gameSlug. Other scopes reject gameSlug. Omitted status defaults to active cases; view=history selects closed cases. Ordered lastReportedAt DESC, id DESC; cursor pagination only; limit defaults 20 (max 100). Counts preserve historical complaints and distinct reporters; deleting a reporter keeps the evidence with a null reporter.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
  })
  @ApiOkResponse({
    description:
      'items: case id, targetType, targetId, gameId/game, native status, reportCount, uniqueReporterCount, currentRiskScore/currentRiskLevel, assignedModeratorId/assignedModerator, resolvedById/resolvedBy, resolvedAt, createdAt, updatedAt, lastReportedAt. Assigned moderator summaries also include username/role; other user summaries contain id/name/image; game contains id/name/slug. No reports, snapshot, full target body or resolutionNote. Response is {items,nextCursor}; nextCursor is null at the end. Lightweight targetPreview is {title (max 160), excerpt (max 240), thumbnailUrl (one image), author {id,name,username,image}} or null; targetState is available/deleted/missing. reasonSummary is [{reasonCode,count}], grouped from surviving evidence, count DESC then reasonCode ASC (at most 10 enum reasons). No reports[] or full content/media/storage fields. Cursor encodes the exclusive {lastReportedAt,id} boundary. Stable lastReportedAt DESC,id DESC; evidence remains in detail.' +
      AI_ADVISORY_DESCRIPTION,
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
      'ADMIN / PLATFORM_MODERATOR only. Includes resolutionNote, aggregate reasonSummary and case summary fields (no targetPreview; current target is returned separately). targetState is available, deleted or missing; a missing target gives target=null while case/evidence remain readable. Current target is distinct from historical per-Report snapshot evidence. First evidence page is limited to 20, ordered createdAt DESC, id DESC. Stored counters are not recomputed on reads.',
  })
  @ApiOkResponse({
    description:
      'Case detail plus aggregate reasonSummary and target (explicit POST/COMMENT projection), targetState, and evidence { items, nextCursor }. Evidence items: id, reporter {id,name,image}, reasonCode, details, createdAt, snapshot|null. Snapshot version 1 allowlists targetType/targetId, authorId, content, title, status, visibility, postId, parentId and up to 20 media entries (url/mediaType/altText). Unknown/malformed snapshots are null. Raw targetSnapshot JSON and storage identifiers are excluded. Follow nextCursor using GET /moderation/cases/:caseId/reports.' +
      AI_ADVISORY_DESCRIPTION,
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
  @Get(':caseId/assignees')
  @ApiOperation({
    summary: 'Find eligible active case assignees by handle or name',
  })
  assignees(
    @Session() session: UserSession,
    @Param('caseId') caseId: string,
    @Query() query: QueryCaseAssigneesDto,
  ) {
    return this.reportModerationService.searchAssignees(
      session.user.id,
      caseId,
      query.q,
    );
  }

  @Patch(':caseId/assignee')
  @ApiOperation({
    summary: 'Assign or reassign an active case to an eligible moderator',
  })
  assign(
    @Session() session: UserSession,
    @Param('caseId') caseId: string,
    @Body() dto: AssignCaseDto,
  ) {
    return this.reportModerationService.assignCaseForPlatform(
      session.user.id,
      caseId,
      dto.assigneeId,
    );
  }

  @Patch(':caseId/claim')
  @ApiParam({
    name: 'caseId',
    description: 'ModerationCase ID, never a Report ID.',
  })
  @ApiOperation({
    summary: 'Claim an OPEN case. ADMIN / PLATFORM_MODERATOR only.',
    description:
      'OPEN -> IN_REVIEW. Returns native case workflow projection. Conditional write and CASE_CLAIMED audit commit atomically.',
  })
  @ApiConflictResponse({ description: 'Case is no longer OPEN.' })
  claim(@Session() session: UserSession, @Param('caseId') caseId: string) {
    return this.reportModerationService.claimCaseForPlatform(
      session.user.id,
      caseId,
    );
  }

  @Patch(':caseId/resolve')
  @ApiParam({ name: 'caseId', description: 'ModerationCase ID.' })
  @ApiOperation({
    summary: 'Resolve an OPEN/IN_REVIEW case. ADMIN / PLATFORM_MODERATOR only.',
    description:
      'Any authorized platform moderator may finalize; assignment ownership is not required. Native case projection and atomic CASE_RESOLVED audit.',
  })
  @ApiConflictResponse({ description: 'Case is closed.' })
  resolve(
    @Session() session: UserSession,
    @Param('caseId') caseId: string,
    @Body() dto: ResolveModerationCaseDto,
  ) {
    return this.reportModerationService.resolveCaseForPlatform(
      session.user.id,
      caseId,
      dto,
    );
  }

  @Patch(':caseId/dismiss')
  @ApiParam({ name: 'caseId', description: 'ModerationCase ID.' })
  @ApiOperation({
    summary: 'Dismiss an OPEN/IN_REVIEW case. ADMIN / PLATFORM_MODERATOR only.',
    description:
      'Returns native case projection. Conditional write and CASE_DISMISSED audit commit atomically.',
  })
  @ApiConflictResponse({ description: 'Case is closed.' })
  dismiss(
    @Session() session: UserSession,
    @Param('caseId') caseId: string,
    @Body() dto: ResolveModerationCaseDto,
  ) {
    return this.reportModerationService.dismissCaseForPlatform(
      session.user.id,
      caseId,
      dto,
    );
  }
}
