import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Repository responsible for database access related to game moderators.
 *
 * This layer should only contain Prisma queries.
 * Business rules should stay inside GameModeratorsService.
 */
@Injectable()
export class GameModeratorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds a game by slug.
   *
   * This is used because moderator assignment routes are nested under:
   * /games/:gameSlug/moderators
   */
  findGameBySlug(slug: string) {
    return this.prisma.game.findUnique({
      where: {
        slug,
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });
  }

  /**
   * Finds a user by id.
   *
   * This is used when admin assigns moderator using userId.
   */
  findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
      },
    });
  }

  /**
   * Finds a user by email.
   *
   * This is useful for admin tools because email is easier to copy
   * than a database id.
   */
  findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
      },
    });
  }

  /**
   * Finds whether a user is already a moderator of the selected game.
   *
   * This prevents duplicate moderator assignment.
   */
  findByGameIdAndUserId(gameId: string, userId: string) {
    return this.prisma.gameModerator.findUnique({
      where: {
        gameId_userId: {
          gameId,
          userId,
        },
      },
    });
  }

  /**
   * Lists all moderators assigned to a specific game.
   *
   * The response includes basic user information so admin pages can display
   * who is currently moderating the game.
   */
  findManyByGameId(gameId: string) {
    return this.prisma.gameModerator.findMany({
      where: {
        gameId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            status: true,
          },
        },
        assigner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Creates a moderator assignment.
   *
   * This means the selected user can moderate content inside the selected game.
   */
  create(data: Prisma.GameModeratorCreateInput) {
    return this.prisma.gameModerator.create({
      data,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            status: true,
          },
        },
        game: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  /**
   * Deletes a moderator assignment by game id and user id.
   *
   * This removes game-scoped moderation permission from the user.
   */
  deleteByGameIdAndUserId(gameId: string, userId: string) {
    return this.prisma.gameModerator.delete({
      where: {
        gameId_userId: {
          gameId,
          userId,
        },
      },
    });
  }
}
