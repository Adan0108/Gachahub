import { Injectable } from '@nestjs/common';
import { AuditTargetType } from '../generated/prisma/client';
import { AuditLogQueryService } from '../audit-log/audit-log-query.service';
import { GamesRepository } from '../games/games.repository';
import { GameModeratorsRepository } from '../game-moderators/game-moderators.repository';
import { ReportsRepository } from '../reports/reports.repository';
import { UsersRepository } from '../users/users.repository';
import { formatActivityEntries } from './overview-activity.mapper';

/** Top communities / recent activity are a dashboard snapshot, not a full listing - the
 * dedicated Communities and (future) audit log pages own the complete, paginated views. */
const TOP_COMMUNITIES_LIMIT = 8;
const RECENT_ACTIVITY_LIMIT = 8;

/**
 * Backs the admin dashboard's Overview page: platform-wide counts, a
 * snapshot of the most-populated communities, and the most recent
 * moderation activity. Unlike the other admin/* controllers, this one
 * composes data owned by several other modules (users, games, reports,
 * moderators, audit log), so it gets its own module instead of being
 * bolted onto one of theirs - but it still goes through each domain's own
 * repository rather than querying Prisma directly, so "which users count
 * as members", "what counts as an open report", or "what counts as an
 * active game" each stay defined in exactly one place instead of being
 * re-decided here. Turning a raw activity row into a feed entry is a
 * separate concern (presentation, not composition) and lives in
 * overview-activity.mapper.ts.
 *
 * Returns ids/enum values, not display copy - `metrics[].label` and a
 * human label for `activity[].action` are the frontend's job (same as
 * STATUS_LABEL/MODES on the other admin pages), not a backend concern.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly gamesRepository: GamesRepository,
    private readonly reportsRepository: ReportsRepository,
    private readonly gameModeratorsRepository: GameModeratorsRepository,
    private readonly auditLogQueryService: AuditLogQueryService,
  ) {}

  async getOverview() {
    const [
      totalMembers,
      activeCommunities,
      openReports,
      moderatorCount,
      topGames,
      recentActivity,
    ] = await Promise.all([
      this.usersRepository.countActive(),
      this.gamesRepository.countActive(),
      this.reportsRepository.countOpen(),
      this.gameModeratorsRepository.count(),
      this.gamesRepository.findTopByMemberCount(TOP_COMMUNITIES_LIMIT),
      this.auditLogQueryService.listAllForAdmin({
        page: 1,
        limit: RECENT_ACTIVITY_LIMIT,
      }),
    ]);

    const [openReportsByGame, userNameById] = await Promise.all([
      this.reportsRepository.countOpenByGameIds(topGames.map((g) => g.id)),
      this.resolveUserTargetNames(recentActivity.items),
    ]);
    const reportCountByGameId = new Map(
      openReportsByGame.map((row) => [row.gameId, row.count]),
    );

    return {
      metrics: [
        { id: 'members', value: totalMembers },
        { id: 'communities', value: activeCommunities },
        { id: 'reports', value: openReports },
        { id: 'moderators', value: moderatorCount },
      ],
      communities: topGames.map((game) => ({
        id: game.id,
        name: game.name,
        members: game._count.members,
        reports: reportCountByGameId.get(game.id) ?? 0,
      })),
      activity: formatActivityEntries(recentActivity.items, userNameById),
    };
  }

  /**
   * Resolves every USER-targeted entry's name in one batch query instead of
   * one lookup per row - at most RECENT_ACTIVITY_LIMIT ids, so this never
   * grows into an N+1. Kept here rather than in the mapper because it owns
   * the repository call; the mapper only consumes the resulting map.
   */
  private async resolveUserTargetNames(
    entries: { targetType: AuditTargetType; targetId: string }[],
  ) {
    const userTargetIds = entries
      .filter((entry) => entry.targetType === AuditTargetType.USER)
      .map((entry) => entry.targetId);

    const users = await this.usersRepository.findManyNamesByIds(userTargetIds);

    return new Map(users.map((user) => [user.id, user.name]));
  }
}
