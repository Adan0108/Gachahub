import { Injectable } from '@nestjs/common';
import { GameModeratorsService } from '../game-moderators/game-moderators.service';
import { AuditLogRepository } from './audit-log.repository';
import { QueryAuditLogsAdminDto } from './dto/query-audit-logs-admin.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { resolvePagination, toPaginated } from '../common/utils/paginated';

/** Read side of the audit log: a game's trail for its moderators, every game's for admins. */
@Injectable()
export class AuditLogQueryService {
  constructor(
    private readonly auditLogRepository: AuditLogRepository,
    private readonly gameModeratorsService: GameModeratorsService,
  ) {}

  /** Admin or a moderator assigned to that game. */
  async listForModerator(
    gameSlug: string,
    moderatorId: string,
    query: QueryAuditLogsDto,
  ) {
    const gameId = await this.gameModeratorsService.resolveModeratableGameId(
      gameSlug,
      moderatorId,
    );

    return this.list(gameId, query);
  }

  /** Admin only - the controller enforces that with AdminGuard. */
  async listAllForAdmin(query: QueryAuditLogsAdminDto) {
    const gameId = query.gameSlug
      ? await this.gameModeratorsService.resolveGameId(query.gameSlug)
      : undefined;

    return this.list(gameId, query);
  }

  private async list(gameId: string | undefined, query: QueryAuditLogsDto) {
    const { page, limit } = resolvePagination(query);

    const { items, total } = await this.auditLogRepository.findMany({
      gameId,
      action: query.action,
      actorId: query.actorId,
      actorName: query.actorName,
      targetType: query.targetType,
      targetId: query.targetId,
      page,
      limit,
    });

    return toPaginated(items, { page, limit, total });
  }
}
