import { PrismaService } from '../../prisma/prisma.service';
import { loadActiveUser } from '../../common/guards/active-user.util';
import { hasPlatformModerationCapability } from '../../common/guards/moderation-capabilities';
import { QueryPlatformReportsDto } from '../dto/platform-moderation/query-platform-reports.dto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { normalizeText } from '../../common/utils/normalize-text';
import { AuditLogService } from '../../audit-log/audit-log.service';
import type { ReportAuditAction } from '../../audit-log/audit-log.types';
import { GameModeratorsService } from '../../game-moderators/game-moderators.service';
import { QueryReportsAdminDto } from '../admin/query-reports-admin.dto';
import { QueryReportsDto } from '../dto/query-reports.dto';
import { ResolveReportDto } from '../dto/resolve-report.dto';
import { ReportsRepository } from '../reports.repository';
import type { Prisma } from '../../generated/prisma/client';
import { resolvePagination, toPaginated } from '../../common/utils/paginated';

/**
 * Moderator/admin actions on reports: listing a queue, and closing a report
 * out (claim / resolve / dismiss). Split from ReportsService (filing) the
 * same way PostModerationService is split from PostsService - this only
 * needs GameModeratorsService, which filing never touches.
 */
@Injectable()
export class ReportModerationService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly gameModeratorsService: GameModeratorsService,
    private readonly auditLogService: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  /** Read-only report rows; recheck live capability for direct service callers. */
  async listForPlatform(userId: string, query: QueryPlatformReportsDto) {
    const user = await loadActiveUser(this.prisma, userId);
    if (!hasPlatformModerationCapability(user.role)) {
      throw new ForbiddenException('PlatformModerator permission required');
    }

    // Cross-field rules also apply outside the HTTP ValidationPipe.
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
    return this.listByGameId(gameId, query);
  }

  /**
   * Lists reports for one game. Admin or a moderator assigned to that game.
   */
  async listForModerator(
    gameSlug: string,
    moderatorId: string,
    query: QueryReportsDto,
  ) {
    const gameId = await this.gameModeratorsService.resolveModeratableGameId(
      gameSlug,
      moderatorId,
    );

    return this.listByGameId(gameId, query);
  }

  /**
   * Lists reports across every game. Admin only - the controller enforces
   * that with AdminGuard, so there's no per-game permission check here.
   */
  async listAllForAdmin(query: QueryReportsAdminDto) {
    const gameId = query.gameSlug
      ? await this.gameModeratorsService.resolveGameId(query.gameSlug)
      : undefined;

    return this.listByGameId(gameId, query);
  }

  /**
   * Marks a pending report as being worked on by the calling moderator.
   *
   * There's deliberately no separate "is it still pending?" pre-check: the
   * conditional write in the repository is the one source of truth, so a
   * report that isn't claimable gets the same 409 whether it was already
   * IN_REVIEW before this request or got claimed by someone else mid-request.
   */
  async claim(gameSlug: string, reportId: string, moderatorId: string) {
    const { gameId } = await this.authorizeReport(
      gameSlug,
      reportId,
      moderatorId,
    );

    const claimed = await this.reportsRepository.claim(reportId, moderatorId, {
      gameId,
      audit: (report, tx) =>
        this.recordAudit(
          'REPORT_CLAIMED',
          {
            gameId,
            gameSlug,
            moderatorId,
            report,
          },
          tx,
        ),
    });

    if (!claimed) {
      throw new ConflictException('This report is no longer pending');
    }

    return claimed;
  }

  async resolve(
    gameSlug: string,
    reportId: string,
    moderatorId: string,
    dto: ResolveReportDto,
  ) {
    return this.finalize({
      gameSlug,
      reportId,
      moderatorId,
      status: 'RESOLVED',
      resolutionNote: dto.resolutionNote,
    });
  }

  async dismiss(
    gameSlug: string,
    reportId: string,
    moderatorId: string,
    dto: ResolveReportDto,
  ) {
    return this.finalize({
      gameSlug,
      reportId,
      moderatorId,
      status: 'DISMISSED',
      resolutionNote: dto.resolutionNote,
    });
  }

  private async finalize(params: {
    gameSlug: string;
    reportId: string;
    moderatorId: string;
    status: 'RESOLVED' | 'DISMISSED';
    resolutionNote?: string;
  }) {
    const { gameSlug, reportId, moderatorId, status, resolutionNote } = params;

    const { gameId } = await this.authorizeReport(
      gameSlug,
      reportId,
      moderatorId,
    );

    // Deliberately not restricted to the case's assignedModeratorId: with no
    // "unclaim" path yet, locking resolve/dismiss to whoever claimed it
    // would let one moderator going offline strand a report forever. Any
    // moderator who can already see this queue can close it out. As with
    // claim(), the repository's conditional write is the only "still open?"
    // check, so an already-closed report always gets the same 409.
    const finalized = await this.reportsRepository.finalize(
      {
        id: reportId,
        status,
        resolvedById: moderatorId,
        resolutionNote: normalizeText(resolutionNote),
      },
      {
        gameId,
        audit: (report, tx) =>
          this.recordAudit(
            status === 'RESOLVED' ? 'REPORT_RESOLVED' : 'REPORT_DISMISSED',
            { gameId, gameSlug, moderatorId, report },
            tx,
          ),
      },
    );

    if (!finalized) {
      throw new ConflictException('This report is already closed');
    }

    return finalized;
  }

  private recordAudit(
    action: ReportAuditAction,
    params: {
      gameId: string;
      gameSlug: string;
      moderatorId: string;
      report: {
        id: string;
        caseId: string;
        targetType: string;
        targetId: string;
        resolutionNote: string | null;
      };
    },
    tx: Prisma.TransactionClient,
  ) {
    const { gameId, gameSlug, moderatorId, report } = params;

    return this.auditLogService.recordOrThrow(
      {
        action,
        actorId: moderatorId,
        targetType: 'REPORT',
        targetId: report.id,
        gameId,
        gameSlug,
        metadata: {
          reportId: report.id,
          caseId: report.caseId,
          reportedTargetType: report.targetType,
          reportedTargetId: report.targetId,
          ...(report.resolutionNote
            ? { resolutionNote: report.resolutionNote }
            : {}),
        },
      },
      tx,
    );
  }

  private async listByGameId(
    gameId: string | null | undefined,
    query: QueryReportsDto,
  ) {
    const { page, limit } = resolvePagination(query);

    const result = await this.reportsRepository.findMany({
      gameId,
      status: query.status,
      targetType: query.targetType,
      page,
      limit,
    });

    return toPaginated(result.items, { page, limit, total: result.total });
  }

  /**
   * Authorizes the caller for the report's game and confirms the report
   * really belongs to the game in the route, via the shared moderation
   * preamble (authorize first, so a non-moderator never learns whether a
   * report exists).
   */
  private authorizeReport(
    gameSlug: string,
    reportId: string,
    moderatorId: string,
  ) {
    return this.gameModeratorsService.loadModeratableResource({
      gameSlug,
      moderatorId,
      notFoundMessage: 'Report not found',
      load: async () => {
        const report = await this.reportsRepository.findById(reportId);
        // A platform case or deleted game cannot belong to a game-scoped route.
        return report && report.gameId !== null
          ? { ...report, gameId: report.gameId }
          : null;
      },
    });
  }
}
