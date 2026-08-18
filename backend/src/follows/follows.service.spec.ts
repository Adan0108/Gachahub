import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  };

  let service: FollowsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FollowsService(repository as any);
  });

  describe('follow', () => {
    it('rejects following yourself', async () => {
      await expect(service.follow('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.findActiveUserById).not.toHaveBeenCalled();
    });

    it('rejects when the target user does not exist or is not active', async () => {
      repository.findActiveUserById.mockResolvedValue(null);

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('creates a follow row when none exists yet', async () => {
      repository.findActiveUserById.mockResolvedValue({ id: 'user-2' });
      repository.find.mockResolvedValue(null);

      const result = await service.follow('user-1', 'user-2');

      expect(repository.create).toHaveBeenCalledWith('user-1', 'user-2');
      expect(result).toEqual({ following: true });
    });

    it('is idempotent when already following', async () => {
      repository.findActiveUserById.mockResolvedValue({ id: 'user-2' });
      repository.find.mockResolvedValue({
        followerId: 'user-1',
        followingId: 'user-2',
      });

      const result = await service.follow('user-1', 'user-2');

      expect(repository.create).not.toHaveBeenCalled();
      expect(result).toEqual({ following: true });
    });
  });

  describe('unfollow', () => {
    it('deletes the follow row and reports not following', async () => {
      repository.delete.mockResolvedValue({ count: 1 });

      const result = await service.unfollow('user-1', 'user-2');

      expect(repository.delete).toHaveBeenCalledWith('user-1', 'user-2');
      expect(result).toEqual({ following: false });
    });

    it('is idempotent when no follow row exists', async () => {
      repository.delete.mockResolvedValue({ count: 0 });

      const result = await service.unfollow('user-1', 'user-2');

      expect(result).toEqual({ following: false });
    });
  });

  describe('isFollowing', () => {
    it('reports true when a follow row exists', async () => {
      repository.find.mockResolvedValue({
        followerId: 'user-1',
        followingId: 'user-2',
      });

      const result = await service.isFollowing('user-1', 'user-2');

      expect(result).toEqual({ following: true });
    });

    it('reports false when no follow row exists', async () => {
      repository.find.mockResolvedValue(null);

      const result = await service.isFollowing('user-1', 'user-2');

      expect(result).toEqual({ following: false });
    });
  });

  describe('getFollowingIdsAmong', () => {
    it('returns a Set of the followed ids among the candidates', async () => {
      repository.findFollowingIdsAmong.mockResolvedValue([
        { followingId: 'user-2' },
        { followingId: 'user-3' },
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
});
