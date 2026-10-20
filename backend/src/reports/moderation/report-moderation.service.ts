import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { loadActiveUser } from '../../common/guards/active-user.util';
import { hasPlatformModerationCapability } from '../../common/guards/moderation-capabilities';
import { normalizeText } from '../../common/utils/normalize-text';
import { AuditLogService } from '../../audit-log/audit-log.service';
import type { CaseAuditAction } from '../../audit-log/audit-log.types';
import { GameModeratorsService } from '../../game-moderators/game-moderators.service';
import { QueryPlatformCasesDto } from '../dto/platform-moderation/query-platform-cases.dto';
import { QueryModerationCasesDto } from '../dto/query-moderation-cases.dto';
import { QueryCaseReportsDto } from '../dto/query-case-reports.dto';
import { ResolveModerationCaseDto } from '../dto/resolve-moderation-case.dto';
import { decodeEvidenceCursor } from '../domain/report-evidence-pagination';
import {
  ReportsRepository,
  type CaseTransitionContext,
} from '../reports.repository';

type CaseDetail = NonNullable<
  Awaited<ReturnType<ReportsRepository['findModerationCaseById']>>
>;
type CaseAction = 'claim' | 'resolve' | 'dismiss';

/** Scope-specific authorization around one shared case read/workflow implementation. */
@Injectable()
export class ReportModerationService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly gameModeratorsService: GameModeratorsService,
    private readonly auditLogService: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  async listCasesForPlatform(userId: string, query: QueryPlatformCasesDto) {
    await this.authorizePlatform(userId);
    const scope = query.scope ?? 'all';
    if (
      !['all', 'platform', 'game'].includes(scope) ||
      (scope === 'game'
        ? typeof query.gameSlug !== 'string' || !query.gameSlug.trim()
        : query.gameSlug !== undefined)
    ) {
      throw new BadRequestException('gameSlug is required only for scope=game');
    }
    const gameId =
      scope === 'game'
        ? await this.gameModeratorsService.resolveGameId(query.gameSlug!)
        : scope === 'platform'
          ? null
          : undefined;
    return this.listCases(gameId, query);
  }

  async getCaseForPlatform(userId: string, caseId: string) {
    await this.authorizePlatform(userId);
    return this.caseDetail(await this.loadCase(caseId));
  }

  async listCaseReportsForPlatform(
    userId: string,
    caseId: string,
    query: QueryCaseReportsDto,
  ) {
    await this.authorizePlatform(userId);
    await this.loadCase(caseId);
    return this.caseReports(caseId, query);
  }

  async listCasesForGame(
    gameSlug: string,
    userId: string,
    query: QueryModerationCasesDto,
  ) {
    const gameId = await this.gameModeratorsService.resolveModeratableGameId(
      gameSlug,
      userId,
    );
    return this.listCases(gameId, query);
  }

  async getCaseForGame(gameSlug: string, userId: string, caseId: string) {
    return this.caseDetail(
      await this.authorizeGameCase(gameSlug, userId, caseId),
    );
  }

  async listCaseReportsForGame(
    gameSlug: string,
    userId: string,
    caseId: string,
    query: QueryCaseReportsDto,
  ) {
    await this.authorizeGameCase(gameSlug, userId, caseId);
    return this.caseReports(caseId, query);
  }

  claimCaseForPlatform(userId: string, caseId: string) {
    return this.mutateCase(userId, caseId, 'claim');
  }
  resolveCaseForPlatform(
    userId: string,
    caseId: string,
    dto: ResolveModerationCaseDto,
  ) {
    return this.mutateCase(userId, caseId, 'resolve', dto.resolutionNote);
  }
  dismissCaseForPlatform(
    userId: string,
    caseId: string,
    dto: ResolveModerationCaseDto,
  ) {
    return this.mutateCase(userId, caseId, 'dismiss', dto.resolutionNote);
  }
  claimCaseForGame(gameSlug: string, userId: string, caseId: string) {
    return this.mutateCase(userId, caseId, 'claim', undefined, gameSlug);
  }
  resolveCaseForGame(
    gameSlug: string,
    userId: string,
    caseId: string,
    dto: ResolveModerationCaseDto,
  ) {
    return this.mutateCase(
      userId,
      caseId,
      'resolve',
      dto.resolutionNote,
      gameSlug,
    );
  }
  dismissCaseForGame(
    gameSlug: string,
    userId: string,
    caseId: string,
    dto: ResolveModerationCaseDto,
  ) {
    return this.mutateCase(
      userId,
      caseId,
      'dismiss',
      dto.resolutionNote,
      gameSlug,
    );
  }

  private async mutateCase(
    userId: string,
    caseId: string,
    action: CaseAction,
    note?: string,
    gameSlug?: string,
  ) {
    let gameId: string | undefined;
    if (gameSlug !== undefined) {
      const moderationCase = await this.authorizeGameCase(
        gameSlug,
        userId,
        caseId,
      );
      gameId = moderationCase.gameId!;
    } else {
      await this.authorizePlatform(userId);
      await this.loadCase(caseId);
    }
    const auditAction: CaseAuditAction =
      action === 'claim'
        ? 'CASE_CLAIMED'
        : action === 'resolve'
          ? 'CASE_RESOLVED'
          : 'CASE_DISMISSED';
    const context: CaseTransitionContext = {
      gameId,
      audit: (moderationCase, tx) =>
        this.auditLogService.recordOrThrow(
          {
            action: auditAction,
            actorId: userId,
            targetType: 'MODERATION_CASE',
            targetId: moderationCase.id,
            gameId: moderationCase.gameId ?? undefined,
            gameSlug: moderationCase.game?.slug,
            metadata: {
              caseId: moderationCase.id,
              targetType: moderationCase.targetType,
              targetId: moderationCase.targetId,
              gameId: moderationCase.gameId,
              reportCount: moderationCase.reportCount,
              ...(moderationCase.resolutionNote
                ? { resolutionNote: moderationCase.resolutionNote }
                : {}),
            },
          },
          tx,
        ),
    };
    // Conditional database update, not the earlier read, decides whether this action wins.
    const result =
      action === 'claim'
        ? await this.reportsRepository.claimCase(caseId, userId, context)
        : await this.reportsRepository.finalizeCase(
            {
              id: caseId,
              status: action === 'resolve' ? 'RESOLVED' : 'DISMISSED',
              resolvedById: userId,
              resolutionNote: normalizeText(note),
            },
            context,
          );
    if (!result)
      throw new ConflictException(
        'This moderation case is no longer eligible for this action',
      );
    return result;
  }

  private async listCases(
    gameId: string | null | undefined,
    query: QueryModerationCasesDto,
  ) {
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeEvidenceCursor(query.cursor);
    if (cursor === null) throw new BadRequestException('Invalid case cursor');
    return this.reportsRepository.findModerationCases({
      gameId,
      status: query.status,
      targetType: query.targetType,
      limit: query.limit ?? 20,
      cursor,
    });
  }

  private async caseDetail(moderationCase: CaseDetail) {
    const [target, evidence, reasons] = await Promise.all([
      this.reportsRepository.findCaseTarget(
        moderationCase.targetType,
        moderationCase.targetId,
      ),
      this.reportsRepository.findReportsByCaseId(moderationCase.id, 20),
      this.reportsRepository.findCaseReasonSummaries([moderationCase.id]),
    ]);
    return {
      ...moderationCase,
      ...target,
      evidence,
      reasonSummary: reasons.get(moderationCase.id) ?? [],
    };
  }

  private caseReports(caseId: string, query: QueryCaseReportsDto) {
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeEvidenceCursor(query.cursor);
    if (cursor === null)
      throw new BadRequestException('Invalid evidence cursor');
    return this.reportsRepository.findReportsByCaseId(
      caseId,
      query.limit ?? 20,
      cursor,
    );
  }

  private async loadCase(caseId: string) {
    const moderationCase =
      await this.reportsRepository.findModerationCaseById(caseId);
    if (!moderationCase)
      throw new NotFoundException('Moderation case not found');
    return moderationCase;
  }

  private async authorizeGameCase(
    gameSlug: string,
    userId: string,
    caseId: string,
  ) {
    const gameId = await this.gameModeratorsService.resolveModeratableGameId(
      gameSlug,
      userId,
    );
    const moderationCase = await this.loadCase(caseId);
    if (moderationCase.gameId !== gameId)
      throw new NotFoundException('Moderation case not found');
    return moderationCase;
  }

  private async authorizePlatform(userId: string) {
    const user = await loadActiveUser(this.prisma, userId);
    if (!hasPlatformModerationCapability(user.role))
      throw new ForbiddenException('PlatformModerator permission required');
  }
}
