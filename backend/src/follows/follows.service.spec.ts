import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client';
import type { FollowsRepository } from './follows.repository';
import { EventPublisherPort } from '../domain-events/event-publisher.port';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('./follows.repository', () => ({
  FollowsRepository: class {},
}));

import { FollowsService } from './follows.service';

describe('FollowsService', () => {
  const repository = {
    findActiveUserById: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findFollowingIdsAmong: jest.fn(),
    findFollowerIdsAmong: jest.fn(),
    countFollowers: jest.fn(),
    countFollowing: jest.fn(),
    findFollowersPage: jest.fn(),
    findFollowingPage: jest.fn(),
  };

  const blocks = { getMutuallyBlockedIdsAmong: jest.fn() };
  const profileAccess = { assertCanView: jest.fn() };

  const eventPublisher = {
    publish: jest.fn(),
    publishMany: jest.fn(),
  };

  const transaction = {} as Prisma.TransactionClient;

  const prisma = {
    $transaction: jest.fn(),
  };

  let service: FollowsService;

  beforeEach(() => {
    jest.resetAllMocks();
    blocks.getMutuallyBlockedIdsAmong.mockResolvedValue(new Set());
    profileAccess.assertCanView.mockResolvedValue(undefined);

    prisma.$transaction.mockImplementation(
      async (
        work: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => work(transaction),
    );

    service = new FollowsService(
      repository as unknown as FollowsRepository,
      eventPublisher as EventPublisherPort,
      prisma as unknown as PrismaService,
      blocks as never,
      profileAccess as never,
    );
  });

  describe('follow', () => {
    it('rejects following yourself', async () => {
      await expect(service.follow('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.findActiveUserById).not.toHaveBeenCalled();

      expect(repository.create).not.toHaveBeenCalled();

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('rejects when the target user does not exist or is not active', async () => {
      repository.findActiveUserById.mockResolvedValue(null);

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );

      expect(repository.create).not.toHaveBeenCalled();

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('refuses to follow someone blocked either way', async () => {
      repository.findActiveUserById.mockResolvedValue({ id: 'user-2' });
      blocks.getMutuallyBlockedIdsAmong.mockResolvedValue(new Set(['user-2']));

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );

      expect(repository.create).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('creates a follow row and publishes user.followed when state changes', async () => {
      repository.findActiveUserById.mockResolvedValue({
        id: 'user-2',
      });

      repository.create.mockResolvedValue({
        count: 1,
      });

      const result = await service.follow('user-1', 'user-2');

      expect(repository.create).toHaveBeenCalledWith(
        transaction,
        'user-1',
        'user-2',
      );

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        {
          type: 'user.followed',
          aggregateId: 'user-2',
          payload: {
            targetUserId: 'user-2',
            actorId: 'user-1',
          },
        },
        transaction,
      );

      expect(result).toEqual({
        following: true,
      });
    });

    it('is idempotent when already following', async () => {
      repository.findActiveUserById.mockResolvedValue({
        id: 'user-2',
      });

      repository.create.mockResolvedValue({
        count: 0,
      });

      const result = await service.follow('user-1', 'user-2');

      expect(repository.create).toHaveBeenCalledWith(
        transaction,
        'user-1',
        'user-2',
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();

      expect(result).toEqual({
        following: true,
      });
    });

    it('does not publish event when follow creation fails', async () => {
      repository.findActiveUserById.mockResolvedValue({
        id: 'user-2',
      });

      repository.create.mockRejectedValue(new Error('Database error'));

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        'Database error',
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('unfollow', () => {
    it('deletes the follow row and reports not following', async () => {
      repository.delete.mockResolvedValue({
        count: 1,
      });

      const result = await service.unfollow('user-1', 'user-2');

      expect(repository.delete).toHaveBeenCalledWith('user-1', 'user-2');

      expect(result).toEqual({
        following: false,
      });
    });

    it('is idempotent when no follow row exists', async () => {
      repository.delete.mockResolvedValue({
        count: 0,
      });

      const result = await service.unfollow('user-1', 'user-2');

      expect(repository.delete).toHaveBeenCalledWith('user-1', 'user-2');

      expect(result).toEqual({
        following: false,
      });
    });
  });

  describe('isFollowing', () => {
    it('reports true when a follow row exists', async () => {
      repository.find.mockResolvedValue({
        followerId: 'user-1',
        followingId: 'user-2',
      });

      const result = await service.isFollowing('user-1', 'user-2');

      expect(repository.find).toHaveBeenCalledWith('user-1', 'user-2');

      expect(result).toEqual({
        following: true,
      });
    });

    it('reports false when no follow row exists', async () => {
      repository.find.mockResolvedValue(null);

      const result = await service.isFollowing('user-1', 'user-2');

      expect(repository.find).toHaveBeenCalledWith('user-1', 'user-2');

      expect(result).toEqual({
        following: false,
      });
    });
  });

  describe('getFollowStatus', () => {
    it('reports both directions, checked independently', async () => {
      repository.find.mockImplementation(
        (followerId: string, followingId: string) =>
          followerId === 'user-1' && followingId === 'user-2'
            ? Promise.resolve({ followerId, followingId })
            : Promise.resolve(null),
      );

      const result = await service.getFollowStatus('user-1', 'user-2');

      expect(result).toEqual({ following: true, followsMe: false });
    });
  });

  describe('getFollowingIdsAmong', () => {
    it('returns a Set of the followed ids among the candidates', async () => {
      repository.findFollowingIdsAmong.mockResolvedValue([
        {
          followingId: 'user-2',
        },
        {
          followingId: 'user-3',
        },
      ]);

      const result = await service.getFollowingIdsAmong('user-1', [
        'user-2',
        'user-3',
        'user-4',
      ]);

      expect(repository.findFollowingIdsAmong).toHaveBeenCalledWith('user-1', [
        'user-2',
        'user-3',
        'user-4',
      ]);

      expect(result).toEqual(new Set(['user-2', 'user-3']));
    });

    it('dedupes candidate ids before querying the repository', async () => {
      repository.findFollowingIdsAmong.mockResolvedValue([]);

      await service.getFollowingIdsAmong('user-1', [
        'user-2',
        'user-2',
        'user-3',
      ]);

      expect(repository.findFollowingIdsAmong).toHaveBeenCalledWith('user-1', [
        'user-2',
        'user-3',
      ]);
    });
  });

  describe('getCounts', () => {
    it('counts followers and following', async () => {
      repository.countFollowers.mockResolvedValue(7);
      repository.countFollowing.mockResolvedValue(3);

      await expect(service.getCounts('user-1')).resolves.toEqual({
        followers: 7,
        following: 3,
      });
    });
  });

  describe('lists of followers and following', () => {
    const person = (id: string) => ({
      id,
      name: `Name ${id}`,
      username: id,
      image: null,
    });
    const query = (extra = {}) => ({ limit: 2, ...extra });

    beforeEach(() => {
      repository.findActiveUserById.mockResolvedValue({ id: 'owner' });
      repository.findFollowingIdsAmong.mockResolvedValue([]);
      repository.findFollowerIdsAmong.mockResolvedValue([]);
    });

    it('gives a page with the cursor of the next one when there are more', async () => {
      repository.findFollowersPage.mockResolvedValue([
        person('a'),
        person('b'),
        person('c'),
      ]);

      const page = await service.listFollowers('owner', 'me', query());

      expect(page.items.map((item) => item.id)).toEqual(['a', 'b']);
      expect(page.nextCursor).toBe('b');
      expect(repository.findFollowersPage).toHaveBeenCalledWith(
        'owner',
        3,
        undefined,
      );
    });

    it('has no next cursor on the last page, and passes the cursor on', async () => {
      repository.findFollowingPage.mockResolvedValue([person('c')]);

      const page = await service.listFollowing(
        'owner',
        'me',
        query({ cursor: 'b' }),
      );

      expect(page).toEqual({
        items: [expect.objectContaining({ id: 'c' })],
        nextCursor: null,
      });
      expect(repository.findFollowingPage).toHaveBeenCalledWith(
        'owner',
        3,
        'b',
      );
    });

    it('says how the viewer relates to each person', async () => {
      repository.findFollowersPage.mockResolvedValue([
        person('a'),
        person('b'),
      ]);
      repository.findFollowingIdsAmong.mockResolvedValue([
        { followingId: 'a' },
      ]);
      repository.findFollowerIdsAmong.mockResolvedValue(['b']);

      const page = await service.listFollowers('owner', 'me', query());

      expect(page.items).toEqual([
        expect.objectContaining({
          id: 'a',
          isFollowing: true,
          followsYou: false,
        }),
        expect.objectContaining({
          id: 'b',
          isFollowing: false,
          followsYou: true,
        }),
      ]);
    });

    it('leaves out anyone blocked either way with the viewer, without losing the cursor', async () => {
      repository.findFollowersPage.mockResolvedValue([
        person('a'),
        person('b'),
        person('c'),
      ]);
      blocks.getMutuallyBlockedIdsAmong.mockResolvedValue(new Set(['b']));

      const page = await service.listFollowers('owner', 'me', query());

      expect(page.items.map((item) => item.id)).toEqual(['a']);
      expect(page.nextCursor).toBe('b');
    });

    it('works for someone not signed in, with no relation to anybody', async () => {
      repository.findFollowersPage.mockResolvedValue([person('a')]);

      const page = await service.listFollowers('owner', undefined, query());

      expect(page.items).toEqual([
        expect.objectContaining({
          id: 'a',
          isFollowing: false,
          followsYou: false,
        }),
      ]);
      expect(blocks.getMutuallyBlockedIdsAmong).not.toHaveBeenCalled();
    });

    it('is not found for a user who does not exist or is not active', async () => {
      repository.findActiveUserById.mockResolvedValue(null);

      await expect(
        service.listFollowers('ghost', 'me', query()),
      ).rejects.toThrow(NotFoundException);
      expect(repository.findFollowersPage).not.toHaveBeenCalled();
    });

    it('refuses a profile the viewer may not see', async () => {
      profileAccess.assertCanView.mockRejectedValue(new ForbiddenException());

      await expect(
        service.listFollowing('owner', 'me', query()),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findFollowingPage).not.toHaveBeenCalled();
    });
  });
});
