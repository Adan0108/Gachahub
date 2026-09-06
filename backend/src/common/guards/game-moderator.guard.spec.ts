import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { GameModeratorGuard } from './game-moderator.guard';

const createContext = (request: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  }) as unknown as ExecutionContext;

describe('GameModeratorGuard', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    game: {
      findUnique: jest.fn(),
    },
    gameModerator: {
      findUnique: jest.fn(),
    },
  };

  let guard: GameModeratorGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new GameModeratorGuard(prisma as any);
  });

  it('throws when request has no authenticated user', async () => {
    await expect(
      guard.canActivate(
        createContext({
          params: {
            gameSlug: 'genshin-impact',
          },
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws when authenticated user is not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'user-1',
          },
          params: {
            gameSlug: 'genshin-impact',
          },
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws when user account is not active', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'SUSPENDED',
    });

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'user-1',
          },
          params: {
            gameSlug: 'genshin-impact',
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows active admin user without checking game moderator assignment', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      role: 'ADMIN',
      status: 'ACTIVE',
    });

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'admin-1',
          },
          params: {
            gameSlug: 'genshin-impact',
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(prisma.game.findUnique).not.toHaveBeenCalled();
    expect(prisma.gameModerator.findUnique).not.toHaveBeenCalled();
  });

  it('throws when normal user has no game context', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
    });

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'user-1',
          },
          params: {},
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws when game is not found', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
    });

    prisma.game.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'user-1',
          },
          params: {
            gameSlug: 'missing-game',
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws when user is not assigned as game moderator', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
    });

    prisma.game.findUnique.mockResolvedValue({
      id: 'game-1',
    });

    prisma.gameModerator.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'user-1',
          },
          params: {
            gameSlug: 'genshin-impact',
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows assigned game moderator', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
    });

    prisma.game.findUnique.mockResolvedValue({
      id: 'game-1',
    });

    prisma.gameModerator.findUnique.mockResolvedValue({
      id: 'moderator-1',
    });

    await expect(
      guard.canActivate(
        createContext({
          user: {
            id: 'user-1',
          },
          params: {
            gameSlug: 'genshin-impact',
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(prisma.gameModerator.findUnique).toHaveBeenCalledWith({
      where: {
        gameId_userId: {
          gameId: 'game-1',
          userId: 'user-1',
        },
      },
      select: {
        id: true,
      },
    });
  });
});
