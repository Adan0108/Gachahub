import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MediaService } from '../media/media.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { GameAuditAction } from '../audit-log/audit-log.types';
import { loadActiveUser } from '../common/guards/active-user.util';
import { GameModeratorsService } from '../game-moderators/game-moderators.service';
import { UserRole, type GameStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BRANDING_SLOTS, type BrandingSlotKey } from './branding-slots';
import { FlagGameDto } from './dto/flag-game.dto';
import { UpdateGameBrandingDto } from './dto/update-game-branding.dto';
import { formatGame } from './game.mapper';
import { BrandingConflictError, GamesRepository } from './games.repository';

// One admin-only status swap, keyed by the direction the caller asked for.
const TRANSITIONS: Record<
  'archive' | 'restore',
  {
    from: GameStatus;
    to: GameStatus;
    auditAction: GameAuditAction;
    rejectionMessage: string;
  }
> = {
  archive: {
    from: 'ACTIVE',
    to: 'ARCHIVED',
    auditAction: 'GAME_ARCHIVED',
    rejectionMessage: 'Only an active game can be archived',
  },
  restore: {
    from: 'ARCHIVED',
    to: 'ACTIVE',
    auditAction: 'GAME_RESTORED',
    rejectionMessage: 'Only an archived game can be restored',
  },
};

const BRANDING_SLOT_KEYS = Object.keys(BRANDING_SLOTS) as BrandingSlotKey[];

// Moderator/admin actions on a game itself (branding, flagging, archive/restore) - split from GamesService since these use a different auth model.
@Injectable()
export class GameModerationService {
  private readonly logger = new Logger(GameModerationService.name);

  constructor(
    private readonly gamesRepository: GamesRepository,
    private readonly gameModeratorsService: GameModeratorsService,
    private readonly mediaService: MediaService,
    private readonly auditLogService: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  // Admin or an assigned moderator of this game only; the old asset (if any) is released best-effort after the new one commits.
  async updateBranding(
    gameSlug: string,
    actorId: string,
    dto: UpdateGameBrandingDto,
  ) {
    const requestedSlots = BRANDING_SLOT_KEYS.filter(
      (key) => dto[BRANDING_SLOTS[key].idField],
    );

    if (requestedSlots.length === 0) {
      throw new BadRequestException(
        'Provide at least one of iconMediaUploadId or bannerMediaUploadId',
      );
    }

    const game = await this.gameModeratorsService.resolveModeratableGame(
      gameSlug,
      actorId,
    );
    this.assertReachable(game.status);

    const resolved = await Promise.all(
      requestedSlots.map(async (key) => {
        const slot = BRANDING_SLOTS[key];
        const [upload] = await this.mediaService.resolveAttachableMedia({
          ids: [dto[slot.idField]!],
          userId: actorId,
          purpose: slot.purpose,
          maxImages: 1,
          maxVideos: 0,
          entityLabel: slot.label,
        });

        return [
          key,
          // Validated non-null by resolveAttachableMedia for every UPLOADED row.
          { id: upload.id, secureUrl: upload.secureUrl! },
        ] as const;
      }),
    );

    const result = await this.gamesRepository
      .claimAndUpdateBranding({
        gameId: game.id,
        actorId,
        slots: Object.fromEntries(resolved),
      })
      .catch((error: unknown) => {
        if (error instanceof BrandingConflictError) {
          throw new ConflictException(
            "This game's branding was changed by someone else - please retry",
          );
        }
        throw error;
      });

    await Promise.all(
      BRANDING_SLOT_KEYS.map((key) => result.previousUploadIds[key])
        .filter((id): id is string => Boolean(id))
        .map((id) => this.releaseOldUpload(id)),
    );

    return formatGame(result.game);
  }

  /** Admin only (checked here via assertIsAdmin, not just the controller's guard) - sets the game's soft-delete status. */
  async archive(gameSlug: string, adminId: string) {
    await this.assertIsAdmin(adminId);
    return this.transitionStatus(gameSlug, adminId, TRANSITIONS.archive);
  }

  /** Admin only (checked here via assertIsAdmin, not just the controller's guard) - reverses archive(). */
  async restore(gameSlug: string, adminId: string) {
    await this.assertIsAdmin(adminId);
    return this.transitionStatus(gameSlug, adminId, TRANSITIONS.restore);
  }

  // Admin or an assigned moderator; no state change, just an audit entry the admin sees on the Overview dashboard.
  async flagForReview(gameSlug: string, actorId: string, dto: FlagGameDto) {
    const game = await this.gameModeratorsService.resolveModeratableGame(
      gameSlug,
      actorId,
    );
    this.assertReachable(game.status);

    await this.auditLogService.record({
      action: 'GAME_FLAGGED',
      actorId,
      targetType: 'GAME',
      targetId: game.id,
      gameId: game.id,
      gameSlug,
      ...(dto.reason ? { metadata: { reason: dto.reason } } : {}),
    });

    return { message: 'Flagged for admin review' };
  }

  private async transitionStatus(
    gameSlug: string,
    adminId: string,
    config: {
      from: GameStatus;
      to: GameStatus;
      auditAction: GameAuditAction;
      rejectionMessage: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.gamesRepository.tryTransitionStatus(tx, {
        slug: gameSlug,
        from: config.from,
        to: config.to,
      });

      if (result.kind === 'not_found') {
        throw new NotFoundException('Game not found');
      }

      if (result.kind === 'invalid_state') {
        throw new BadRequestException(config.rejectionMessage);
      }

      if (result.kind === 'idempotent') {
        return formatGame(result.game);
      }

      await this.auditLogService.recordOrThrow(
        {
          action: config.auditAction,
          actorId: adminId,
          targetType: 'GAME',
          targetId: result.game.id,
          gameId: result.game.id,
          gameSlug: result.game.slug,
        },
        tx,
      );

      return formatGame(result.game);
    });
  }

  // Same check as AdminGuard, asserted here too - not left to the controller's guard alone, same as GameModeratorsService.assertCanModerateGame does for the moderator-inclusive methods.
  private async assertIsAdmin(userId: string): Promise<void> {
    const user = await loadActiveUser(this.prisma, userId);

    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin permission required');
    }
  }

  // Rejects an ARCHIVED game - resolveModeratableGame only checks who's asking, not whether the game itself is still reachable.
  private assertReachable(status: GameStatus): void {
    if (status === 'ARCHIVED') {
      throw new NotFoundException('Game not found');
    }
  }

  private async releaseOldUpload(mediaUploadId: string) {
    try {
      await this.mediaService.releaseAttachedUpload(mediaUploadId);
    } catch (error) {
      this.logger.warn(
        `Failed to release media ${mediaUploadId} after game branding replace`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.mediaService.markReleaseFailed(mediaUploadId).catch(() => {
        // Already RELEASE_FAILED or gone; the next sweep handles it.
      });
    }
  }
}
