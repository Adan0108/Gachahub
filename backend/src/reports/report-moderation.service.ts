import { ConflictException, Injectable } from '@nestjs/common';
import { normalizeText } from '../common/utils/normalize-text';
import { GameModeratorsService } from '../game-moderators/game-moderators.service';
import { QueryReportsAdminDto } from './dto/query-reports-admin.dto';
import { QueryReportsDto } from './dto/query-reports.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { ReportsRepository } from './reports.repository';

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
  ) {}

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
    await this.authorizeReport(gameSlug, reportId, moderatorId);

    const claimed = await this.reportsRepository.claim(reportId, moderatorId);

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

    await this.authorizeReport(gameSlug, reportId, moderatorId);

    // Deliberately not restricted to report.assignedModeratorId: with no
    // "unclaim" path yet, locking resolve/dismiss to whoever claimed it
    // would let one moderator going offline strand a report forever. Any
    // moderator who can already see this queue can close it out. As with
    // claim(), the repository's conditional write is the only "still open?"
    // check, so an already-closed report always gets the same 409.
    const finalized = await this.reportsRepository.finalize({
      id: reportId,
      status,
      resolvedById: moderatorId,
      resolutionNote: normalizeText(resolutionNote),
    });

    if (!finalized) {
      throw new ConflictException('This report is already closed');
    }

    return finalized;
  }

  private async listByGameId(
    gameId: string | undefined,
    query: QueryReportsDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const result = await this.reportsRepository.findMany({
      gameId,
      status: query.status,
      targetType: query.targetType,
      page,
      limit,
    });

    return {
      items: result.items,
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
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
      load: () => this.reportsRepository.findById(reportId),
    });
  }
}
