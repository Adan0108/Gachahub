import { Injectable } from '@nestjs/common';
import type { Prisma, GameStatus } from '../generated/prisma/client';
import { claimUploadsForAttachment } from '../media/media.repository';
import { PrismaService } from '../prisma/prisma.service';
import {
  BRANDING_SLOTS,
  type BrandingSlotKey,
  type BrandingUpload,
} from './branding-slots';

// Thrown from inside claimAndUpdateBranding's transaction on a CAS miss, so Prisma rolls back the claim(s) too; the service maps it to a 409.
export class BrandingConflictError extends Error {}

/** Discriminated outcome of a conditional status swap - lets the caller pick the exact exception/response without a redundant pre-read. */
type TransitionResult =
  | { kind: 'success'; game: Prisma.GameGetPayload<object> }
  | { kind: 'idempotent'; game: Prisma.GameGetPayload<object> }
  | { kind: 'invalid_state'; game: Prisma.GameGetPayload<object> }
  | { kind: 'not_found' };

/** Shared by count() and findTopByMemberCount() so "what counts as active" can't drift between them. */
const ACTIVE_GAME = {
  status: 'ACTIVE',
} as const satisfies Prisma.GameWhereInput;

/**
 * Repository responsible for all database queries related to games.
 *
 * This layer should only contain Prisma/database logic.
 * Business decisions should stay inside GamesService.
 */
@Injectable()
export class GamesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds multiple games using filtering, searching, ordering, and pagination.
   *
   * This is used by GET /games.
   * It keeps Prisma query logic out of the controller/service layer.
   */
  findMany(params: {
    where?: Prisma.GameWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.GameOrderByWithRelationInput;
  }) {
    return this.prisma.game.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
    });
  }

  /**
   * Counts games that match a filter.
   *
   * This is useful for pagination metadata.
   */
  count(where?: Prisma.GameWhereInput) {
    return this.prisma.game.count({
      where,
    });
  }

  /** Total ACTIVE games - the admin dashboard's "Active communities" metric. */
  countActive() {
    return this.prisma.game.count({ where: ACTIVE_GAME });
  }

  /**
   * The most-populated active games, by live member count - for the admin
   * dashboard's communities snapshot. Counts the GameMember relation
   * directly rather than reading the denormalized Game.memberCount column,
   * which nothing in the app ever writes (it's set once by the seed script
   * and drifts from there). Tiebreaks on id so equal counts - everyone's at
   * 0 on an unseeded database - still return in a stable, deterministic order.
   * Every row is ACTIVE by construction, so the caller has no use for the
   * status field - left out of the select rather than shown as constant noise.
   */
  findTopByMemberCount(limit: number) {
    return this.prisma.game.findMany({
      where: ACTIVE_GAME,
      orderBy: [{ members: { _count: 'desc' } }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        _count: { select: { members: true } },
      },
    });
  }

  /**
   * Finds a single game by its unique database id.
   *
   * This is mainly used for update logic and internal checks.
   */
  findById(id: string) {
    return this.prisma.game.findUnique({
      where: { id },
    });
  }

  /**
   * Finds a single game by slug.
   *
   * This is used for public routes because slugs are cleaner than ids.
   * Example: /games/wuthering-waves
   */
  findBySlug(slug: string) {
    return this.prisma.game.findUnique({
      where: { slug },
      include: {
        categories: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    });
  }

  /**
   * Creates a new game record.
   *
   * The service is responsible for validating uniqueness before calling this.
   */
  create(data: Prisma.GameCreateInput) {
    return this.prisma.game.create({
      data,
    });
  }

  /**
   * Updates a game by id.
   *
   * The service checks whether the game exists before updating.
   */
  update(id: string, data: Prisma.GameUpdateInput) {
    return this.prisma.game.update({
      where: { id },
      data,
    });
  }

  // Claims the upload(s) and writes branding in one transaction, CAS-keyed on each slot's current id column read as its first statement; throws BrandingConflictError on a miss so the claim(s) roll back too.
  async claimAndUpdateBranding(params: {
    gameId: string;
    actorId: string;
    slots: Partial<Record<BrandingSlotKey, BrandingUpload>>;
  }): Promise<{
    game: Prisma.GameGetPayload<object>;
    previousUploadIds: Partial<Record<BrandingSlotKey, string | null>>;
  }> {
    const { gameId, actorId, slots } = params;
    const entries = Object.entries(slots) as [
      BrandingSlotKey,
      BrandingUpload,
    ][];

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.game.findUniqueOrThrow({
        where: { id: gameId },
        select: { iconMediaUploadId: true, bannerMediaUploadId: true },
      });

      for (const [key, upload] of entries) {
        await claimUploadsForAttachment(tx, {
          ids: [upload.id],
          userId: actorId,
          purpose: BRANDING_SLOTS[key].purpose,
        });
      }

      const where: Record<string, unknown> = { id: gameId };
      const data: Record<string, unknown> = {};
      const previousUploadIds: Partial<Record<BrandingSlotKey, string | null>> =
        {};

      for (const [key, upload] of entries) {
        const slot = BRANDING_SLOTS[key];
        where[slot.idField] = current[slot.idField];
        data[slot.urlField] = upload.secureUrl;
        data[slot.idField] = upload.id;
        previousUploadIds[key] = current[slot.idField];
      }

      const result = await tx.game.updateMany({ where, data });

      if (result.count === 0) {
        throw new BrandingConflictError();
      }

      const game = await tx.game.findUniqueOrThrow({ where: { id: gameId } });

      return { game, previousUploadIds };
    });
  }

  // Conditional status swap (same race protection as PostsRepository.transitionStatus), run inside the caller's tx; discriminates not-found/idempotent/invalid-state instead of collapsing to one null.
  async tryTransitionStatus(
    tx: Prisma.TransactionClient,
    params: { slug: string; from: GameStatus; to: GameStatus },
  ): Promise<TransitionResult> {
    const result = await tx.game.updateMany({
      where: { slug: params.slug, status: params.from },
      data: { status: params.to },
    });

    if (result.count > 0) {
      const game = await tx.game.findUniqueOrThrow({
        where: { slug: params.slug },
      });

      return { kind: 'success', game };
    }

    const game = await tx.game.findUnique({ where: { slug: params.slug } });

    if (!game) {
      return { kind: 'not_found' };
    }

    if (game.status === params.to) {
      return { kind: 'idempotent', game };
    }

    return { kind: 'invalid_state', game };
  }
}
