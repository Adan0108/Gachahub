jest.mock('./blocks.repository', () => ({
  BlocksRepository: class {},
}));

import { BadRequestException } from '@nestjs/common';
import { BlocksService } from './blocks.service';

describe('BlocksService', () => {
  const repository = {
    find: jest.fn(),
    findBlockedIdsAmong: jest.fn(),
    findBlocksBetween: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };

  let service: BlocksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlocksService(repository as any);
  });

  describe('isBlocked', () => {
    it('reports true when a block row exists', async () => {
      repository.find.mockResolvedValue({
        blockerId: 'user-1',
        blockedId: 'user-2',
      });

      const result = await service.isBlocked('user-1', 'user-2');

      expect(repository.find).toHaveBeenCalledWith('user-1', 'user-2');
      expect(result).toBe(true);
    });

    it('reports false when no block row exists', async () => {
      repository.find.mockResolvedValue(null);

      const result = await service.isBlocked('user-1', 'user-2');

      expect(result).toBe(false);
    });
  });

  describe('getBlockedIdsAmong', () => {
    it('returns a Set of the blocked ids among the candidates', async () => {
      repository.findBlockedIdsAmong.mockResolvedValue([
        { blockedId: 'user-2' },
        { blockedId: 'user-3' },
      ]);

      const result = await service.getBlockedIdsAmong('user-1', [
        'user-2',
        'user-3',
        'user-4',
      ]);

      expect(repository.findBlockedIdsAmong).toHaveBeenCalledWith('user-1', [
        'user-2',
        'user-3',
        'user-4',
      ]);
      expect(result).toEqual(new Set(['user-2', 'user-3']));
    });

    it('returns an empty Set when nothing is blocked', async () => {
      repository.findBlockedIdsAmong.mockResolvedValue([]);

      const result = await service.getBlockedIdsAmong('user-1', ['user-2']);

      expect(result).toEqual(new Set());
    });
  });

  describe('block', () => {
    it('rejects blocking yourself', () => {
      expect(() => service.block('user-1', 'user-1')).toThrow(
        BadRequestException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('creates the block row', async () => {
      await service.block('user-1', 'user-2');

      expect(repository.create).toHaveBeenCalledWith('user-1', 'user-2');
    });
  });

  describe('unblock', () => {
    it('returns the deleted row count', async () => {
      repository.delete.mockResolvedValue({ count: 1 });

      const result = await service.unblock('user-1', 'user-2');

      expect(repository.delete).toHaveBeenCalledWith('user-1', 'user-2');
      expect(result).toBe(1);
    });

    it('is idempotent when no block row exists', async () => {
      repository.delete.mockResolvedValue({ count: 0 });

      const result = await service.unblock('user-1', 'user-2');

      expect(result).toBe(0);
    });
  });

  describe('getMutuallyBlockedIdsAmong', () => {
    it('gives the other person of each block, whichever way it went', async () => {
      repository.findBlocksBetween.mockResolvedValue([
        { blockerId: 'me', blockedId: 'bo' },
        { blockerId: 'cy', blockedId: 'me' },
      ]);

      const blocked = await service.getMutuallyBlockedIdsAmong('me', [
        'bo',
        'cy',
        'di',
      ]);

      expect([...blocked].sort()).toEqual(['bo', 'cy']);
      expect(repository.findBlocksBetween).toHaveBeenCalledWith('me', [
        'bo',
        'cy',
        'di',
      ]);
    });

    it('is empty when there are no blocks', async () => {
      repository.findBlocksBetween.mockResolvedValue([]);

      await expect(
        service.getMutuallyBlockedIdsAmong('me', ['bo']),
      ).resolves.toEqual(new Set());
    });
  });
});
