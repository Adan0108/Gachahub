jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { GameMembershipRepository } from './game-membership.repository';
import { GameMembershipService } from './game-membership.service';

describe('GameMembershipService', () => {
  const repository = {
    findGameBySlug: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    status: jest.fn(),
    list: jest.fn(),
  };
  const prisma = { user: { findUnique: jest.fn() } };
  const service = new GameMembershipService(
    repository as unknown as GameMembershipRepository,
    prisma as unknown as PrismaService,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'me',
      status: 'ACTIVE',
      role: 'USER',
    });
    repository.findGameBySlug.mockResolvedValue({
      id: 'game',
      status: 'ACTIVE',
    });
    repository.join.mockResolvedValue({ joined: true });
    repository.leave.mockResolvedValue({ joined: false });
  });
  it('allows ordinary authenticated users independently of GameModerator', async () => {
    expect(await service.join('wuwa', 'me')).toEqual({ joined: true });
    expect(repository.join).toHaveBeenCalledWith('game', 'me');
  });
  it.each(['join', 'leave', 'status'] as const)(
    'rejects unauthenticated %s before touching memberships',
    async (method) => {
      await expect(service[method]('wuwa', undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(repository.findGameBySlug).not.toHaveBeenCalled();
    },
  );
  it('rejects unauthenticated listing', async () => {
    await expect(service.list(undefined)).rejects.toThrow(
      UnauthorizedException,
    );
  });
  it('rejects inactive accounts', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'me', status: 'BANNED' });
    await expect(service.join('wuwa', 'me')).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('rejects missing and archived games for join', async () => {
    repository.findGameBySlug.mockResolvedValueOnce(null);
    await expect(service.join('missing', 'me')).rejects.toThrow(
      NotFoundException,
    );
    repository.findGameBySlug.mockResolvedValueOnce({
      id: 'game',
      status: 'ARCHIVED',
    });
    await expect(service.join('archived', 'me')).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.join).not.toHaveBeenCalled();
  });
  it('permits leaving an archived community', async () => {
    repository.findGameBySlug.mockResolvedValueOnce({
      id: 'game',
      status: 'ARCHIVED',
    });
    expect(await service.leave('wuwa', 'me')).toEqual({ joined: false });
    expect(repository.leave).toHaveBeenCalledWith('game', 'me');
  });
  it('lists normal game responses without internal branding identifiers', async () => {
    repository.list.mockResolvedValue([
      {
        id: 'game',
        iconMediaUploadId: 'private',
        bannerMediaUploadId: 'private',
      },
    ]);
    expect(await service.list('me')).toEqual({ items: [{ id: 'game' }] });
    expect(repository.list).toHaveBeenCalledWith('me');
  });
});
