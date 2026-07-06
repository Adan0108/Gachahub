import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Repository responsible for database access related to game categories.
 *
 * This layer should only contain Prisma query logic.
 */
@Injectable()
export class GameCategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds all categories for a specific game.
   *
   * Categories are ordered by sortOrder first, then by name.
   * This allows the frontend to display categories in a stable order.
   */
  findManyByGameId(gameId: string, where?: Prisma.GameCategoryWhereInput) {
    return this.prisma.gameCategory.findMany({
      where: {
        gameId,
        ...where,
      },
      orderBy: [
        {
          sortOrder: 'asc',
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  /**
   * Finds a category by id.
   *
   * This is used before update operations.
   */
  findById(id: string) {
    return this.prisma.gameCategory.findUnique({
      where: { id },
    });
  }

  /**
   * Finds a category by game id and slug.
   *
   * This is used to enforce the unique gameId + slug rule.
   */
  findByGameIdAndSlug(gameId: string, slug: string) {
    return this.prisma.gameCategory.findUnique({
      where: {
        gameId_slug: {
          gameId,
          slug,
        },
      },
    });
  }

  /**
   * Creates a category inside a game.
   *
   * The service handles game existence and duplicate slug checks first.
   */
  create(data: Prisma.GameCategoryCreateInput) {
    return this.prisma.gameCategory.create({
      data,
    });
  }

  /**
   * Updates a category by id.
   *
   * The service handles validation and duplicate slug checks first.
   */
  update(id: string, data: Prisma.GameCategoryUpdateInput) {
    return this.prisma.gameCategory.update({
      where: { id },
      data,
    });
  }
}
