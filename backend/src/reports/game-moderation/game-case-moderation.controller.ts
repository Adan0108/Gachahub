import { AI_ADVISORY_DESCRIPTION } from '../domain/ai-advisory';
import { AssignCaseDto } from '../dto/assign-case.dto';
import { QueryCaseAssigneesDto } from '../dto/query-case-assignees.dto';
import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ReportModerationService } from '../moderation/report-moderation.service';
import { QueryModerationCasesDto } from '../dto/query-moderation-cases.dto';
import { QueryCaseReportsDto } from '../dto/query-case-reports.dto';
import { ResolveModerationCaseDto } from '../dto/resolve-moderation-case.dto';

@ApiTags('Moderation cases')
@ApiCookieAuth('better-auth.session_token')
@ApiParam({
  name: 'gameSlug',
  description:
    'Exact assigned game; ADMIN and PLATFORM_MODERATOR need no assignment.',
})
@ApiUnauthorizedResponse({ description: 'Authentication required.' })
@ApiForbiddenResponse({
  description:
    'Active ADMIN, PLATFORM_MODERATOR or assigned GameModerator required; live database authorization runs before case lookup.',
})
@ApiNotFoundResponse({
  description:
    'Game/case missing, case belongs to another game, or case has null gameId.',
})
@ApiBadRequestResponse({
  description: 'Invalid native filter, pagination, cursor or resolution note.',
})
@Controller('games/:gameSlug/moderation/cases')
export class GameCaseModerationController {
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
  @ApiOkResponse({
    description:
      '{items,nextCursor}: native case summaries with game/user summaries, stored counters, risk, assignment/resolution timestamps. nextCursor is null at the end; evidence and target bodies are excluded. Lightweight targetPreview is {title (max 160), excerpt (max 240), thumbnailUrl (one image), author {id,name,username,image}} or null; targetState is available/deleted/missing. reasonSummary is [{reasonCode,count}], grouped from surviving evidence, count DESC then reasonCode ASC (at most 10 enum reasons). No reports[] or full content/media/storage fields. Cursor encodes the exclusive {lastReportedAt,id} boundary. Stable lastReportedAt DESC,id DESC; evidence remains in detail.' +
      AI_ADVISORY_DESCRIPTION,
  })
  @ApiOperation({
    summary: 'List case workflows in this exact game.',
    description:
      'One case per row; native OPEN/IN_REVIEW/RESOLVED/DISMISSED statuses. Cursor-only DB-side lastReportedAt DESC,id DESC pagination; limit defaults to 20 (maximum 100). Stored reportCount/uniqueReporterCount may exceed surviving evidence after reporter deletion. No reports collection or snapshot in list.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
  })
  list(
    @Param('gameSlug') gameSlug: string,
    @Session() session: UserSession,
    @Query() query: QueryModerationCasesDto,
  ) {
    return this.reportModerationService.listCasesForGame(
      gameSlug,
      session.user.id,
      query,
    );
  }

  @Get(':caseId')
  @ApiOkResponse({
    description:
      'Case fields plus resolutionNote, aggregate reasonSummary, target, targetState, evidence {items,nextCursor}. Snapshot projection is allowlisted; missing targets remain readable.' +
      AI_ADVISORY_DESCRIPTION,
  })
  @ApiParam({
    name: 'caseId',
    description: 'ModerationCase ID, never a Report ID.',
  })
  @ApiOperation({
    summary:
      'Read an exact-game case, current target and first 20 evidence items.',
    description:
      'Includes resolution metadata, targetState available/deleted/missing, and evidence {items,nextCursor}. Missing target is tolerated. Evidence snapshots are allowlisted, distinct from current target. Counters are stored aggregates.',
  })
  detail(
    @Param('gameSlug') gameSlug: string,
    @Param('caseId') caseId: string,
    @Session() session: UserSession,
  ) {
    return this.reportModerationService.getCaseForGame(
      gameSlug,
      session.user.id,
      caseId,
    );
  }

  @Get(':caseId/reports')
  @ApiOkResponse({
    description:
      '{items,nextCursor}; evidence items contain id, reporter summary, reasonCode, details, createdAt and allowlisted snapshot|null. Empty evidence is permitted.',
  })
  @ApiParam({ name: 'caseId', description: 'ModerationCase ID.' })
  @ApiOperation({
    summary: 'Read bounded complaint evidence for this game case.',
    description:
      'limit default 20/max 100; opaque cursor uses exclusive createdAt DESC,id DESC boundary. Returns {items,nextCursor}; raw targetSnapshot is excluded.',
  })
  reports(
    @Param('gameSlug') gameSlug: string,
    @Param('caseId') caseId: string,
    @Session() session: UserSession,
    @Query() query: QueryCaseReportsDto,
  ) {
    return this.reportModerationService.listCaseReportsForGame(
      gameSlug,
      session.user.id,
      caseId,
      query,
    );
  }

  @Get(':caseId/assignees')
  @ApiOperation({ summary: 'Find eligible assignees for this exact game case' })
  assignees(
    @Param('gameSlug') gameSlug: string,
    @Session() session: UserSession,
    @Param('caseId') caseId: string,
    @Query() query: QueryCaseAssigneesDto,
  ) {
    return this.reportModerationService.searchAssignees(
      session.user.id,
      caseId,
      query.q,
      gameSlug,
    );
  }

  @Patch(':caseId/assignee')
  @ApiOperation({
    summary: 'Assign or reassign an active game case to an eligible moderator',
  })
  assign(
    @Param('gameSlug') gameSlug: string,
    @Session() session: UserSession,
    @Param('caseId') caseId: string,
    @Body() dto: AssignCaseDto,
  ) {
    return this.reportModerationService.assignCaseForGame(
      gameSlug,
      session.user.id,
      caseId,
      dto.assigneeId,
    );
  }

  @Patch(':caseId/claim')
  @ApiOkResponse({
    description:
      'Updated native ModerationCase workflow projection, including resolutionNote; no Report entity or evidence collection.',
  })
  @ApiParam({ name: 'caseId', description: 'ModerationCase ID.' })
  @ApiOperation({
    summary: 'Claim an OPEN game case: OPEN -> IN_REVIEW.',
    description:
      'Returns native case workflow projection. Atomic case audit; conflicting transition returns 409.',
  })
  @ApiConflictResponse({
    description:
      'Case is no longer OPEN or game ownership changed concurrently.',
  })
  claim(
    @Param('gameSlug') gameSlug: string,
    @Param('caseId') caseId: string,
    @Session() session: UserSession,
  ) {
    return this.reportModerationService.claimCaseForGame(
      gameSlug,
      session.user.id,
      caseId,
    );
  }

  @Patch(':caseId/resolve')
  @ApiOkResponse({
    description:
      'Updated native ModerationCase workflow projection, including resolutionNote; no Report entity or evidence collection.',
  })
  @ApiParam({ name: 'caseId', description: 'ModerationCase ID.' })
  @ApiOperation({
    summary: 'Resolve an OPEN/IN_REVIEW game case.',
    description:
      'Any authorized game moderator may finalize; assignment ownership is not required. Atomic CASE_RESOLVED audit.',
  })
  @ApiConflictResponse({
    description: 'Case is closed or game ownership changed concurrently.',
  })
  resolve(
    @Param('gameSlug') gameSlug: string,
    @Param('caseId') caseId: string,
    @Session() session: UserSession,
    @Body() dto: ResolveModerationCaseDto,
  ) {
    return this.reportModerationService.resolveCaseForGame(
      gameSlug,
      session.user.id,
      caseId,
      dto,
    );
  }

  @Patch(':caseId/dismiss')
  @ApiOkResponse({
    description:
      'Updated native ModerationCase workflow projection, including resolutionNote; no Report entity or evidence collection.',
  })
  @ApiParam({ name: 'caseId', description: 'ModerationCase ID.' })
  @ApiOperation({
    summary: 'Dismiss an OPEN/IN_REVIEW game case.',
    description:
      'Any authorized game moderator may finalize. Atomic CASE_DISMISSED audit.',
  })
  @ApiConflictResponse({
    description: 'Case is closed or game ownership changed concurrently.',
  })
  dismiss(
    @Param('gameSlug') gameSlug: string,
    @Param('caseId') caseId: string,
    @Session() session: UserSession,
    @Body() dto: ResolveModerationCaseDto,
  ) {
    return this.reportModerationService.dismissCaseForGame(
      gameSlug,
      session.user.id,
      caseId,
      dto,
    );
  }
}
