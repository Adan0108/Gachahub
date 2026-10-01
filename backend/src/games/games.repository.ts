import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
}
