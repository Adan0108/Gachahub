import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { USER_ROLES } from '../constants/roles.constants';

type GameModeratorRequest = Request & {
  user?: {
    id?: string;
  };
  params: {
    gameSlug?: string;
    gameId?: string;
  };
};

/**
 * GameModeratorGuard protects routes that require game-scoped moderation permission.
 *
 * This guard allows:
 * - ADMIN users to moderate content in any game.
 * - Game moderators to moderate content only inside the game they are assigned to.
 *
 * Normal users are blocked.
 *
 * This guard is designed for future routes such as:
 * - PATCH /games/:gameSlug/posts/:postId/hide
 * - PATCH /games/:gameSlug/comments/:commentId/hide
 * - PATCH /games/:gameSlug/reports/:reportId/resolve
 *
 * Important:
 * The route using this guard should include either:
 * - :gameSlug
 * - :gameId
 *
 * Recommended route style:
 * /games/:gameSlug/posts/:postId/hide
 */
@Injectable()
export class GameModeratorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Checks whether the current authenticated user can moderate the selected game.
   *
   * Flow:
   * 1. Read user id from Better Auth authenticated request.
   * 2. Check user exists and is ACTIVE.
   * 3. Allow immediately if user is ADMIN.
   * 4. Resolve game by gameSlug or gameId.
   * 5. Check if user exists in game_moderators for that game.
   *
   * @param context NestJS request execution context.
   * @returns true if the user can moderate the game.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GameModeratorRequest>();

    const userId = request.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('User account is not active');
    }

    if (user.role === USER_ROLES.ADMIN) {
      return true;
    }

    const gameSlug = request.params.gameSlug;
    const gameId = request.params.gameId;

    if (!gameSlug && !gameId) {
      throw new ForbiddenException(
        'Game context is required for moderation permission',
      );
    }

    const game = gameId
      ? await this.prisma.game.findUnique({
          where: {
            id: gameId,
          },
          select: {
            id: true,
          },
        })
      : await this.prisma.game.findUnique({
          where: {
            slug: gameSlug,
          },
          select: {
            id: true,
          },
        });

    if (!game) {
      throw new ForbiddenException('Game not found');
    }

    const moderator = await this.prisma.gameModerator.findUnique({
      where: {
        gameId_userId: {
          gameId: game.id,
          userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!moderator) {
      throw new ForbiddenException('Game moderator permission required');
    }

    return true;
  }
}
