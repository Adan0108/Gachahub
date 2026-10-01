import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { MlsGroupRosterRepository } from './mls-group-roster.repository';

describe('MlsGroupRosterRepository', () => {
  const makeDb = () => ({
    mlsGroupMember: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
  });

  let prisma: ReturnType<typeof makeDb>;
  let repository: MlsGroupRosterRepository;

  beforeEach(() => {
    prisma = makeDb();
    repository = new MlsGroupRosterRepository(
      prisma as unknown as PrismaService,
    );
  });

  describe('findLeavesAtEpoch', () => {
    it('asks for the devices added by that epoch and not removed until after it', async () => {
      prisma.mlsGroupMember.findMany.mockResolvedValue([]);

      await repository.findLeavesAtEpoch('conv-1', 4);

      expect(prisma.mlsGroupMember.findMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          addedEpoch: { lte: 4 },
          OR: [{ removedEpoch: null }, { removedEpoch: { gt: 4 } }],
        },
        select: { deviceId: true, userId: true },
      });
    });
  });

  describe('hasRoster', () => {
    it('is true when the conversation has any member row', async () => {
      prisma.mlsGroupMember.findFirst.mockResolvedValue({ id: 'm1' });

      await expect(repository.hasRoster('conv-1')).resolves.toBe(true);
      expect(prisma.mlsGroupMember.findFirst).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        select: { id: true },
      });
    });

    it('is false when the conversation has none', async () => {
      prisma.mlsGroupMember.findFirst.mockResolvedValue(null);

      await expect(repository.hasRoster('conv-1')).resolves.toBe(false);
    });

    it('reads through a supplied transaction client instead of the default', async () => {
      const tx = makeDb();
      tx.mlsGroupMember.findFirst.mockResolvedValue(null);

      await repository.hasRoster('conv-1', tx as never);

      expect(tx.mlsGroupMember.findFirst).toHaveBeenCalled();
      expect(prisma.mlsGroupMember.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('findActiveLeaves', () => {
    it('lists only leaves that have not been removed', async () => {
      prisma.mlsGroupMember.findMany.mockResolvedValue([
        { deviceId: 'd1', userId: 'u1' },
      ]);

      await expect(repository.findActiveLeaves('conv-1')).resolves.toEqual([
        { deviceId: 'd1', userId: 'u1' },
      ]);
      expect(prisma.mlsGroupMember.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', removedEpoch: null },
        select: { deviceId: true, userId: true },
      });
    });
  });

  describe('addLeaves', () => {
    it('records each device at the given epoch', async () => {
      await repository.addLeaves(
        'conv-1',
        [
          { deviceId: 'd1', userId: 'u1' },
          { deviceId: 'd2', userId: 'u2' },
        ],
        3,
      );

      expect(prisma.mlsGroupMember.createMany).toHaveBeenCalledWith({
        data: [
          {
            conversationId: 'conv-1',
            deviceId: 'd1',
            userId: 'u1',
            addedEpoch: 3,
          },
          {
            conversationId: 'conv-1',
            deviceId: 'd2',
            userId: 'u2',
            addedEpoch: 3,
          },
        ],
      });
    });

    it('writes nothing for an empty list', async () => {
      await repository.addLeaves('conv-1', [], 3);

      expect(prisma.mlsGroupMember.createMany).not.toHaveBeenCalled();
    });
  });

  describe('removeLeaves', () => {
    it('marks only live leaves as removed and returns how many matched', async () => {
      prisma.mlsGroupMember.updateMany.mockResolvedValue({ count: 2 });

      await expect(
        repository.removeLeaves('conv-1', ['d1', 'd2'], 4),
      ).resolves.toBe(2);
      expect(prisma.mlsGroupMember.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          deviceId: { in: ['d1', 'd2'] },
          removedEpoch: null,
        },
        data: { removedEpoch: 4 },
      });
    });

    it('does nothing for an empty list', async () => {
      await expect(repository.removeLeaves('conv-1', [], 4)).resolves.toBe(0);

      expect(prisma.mlsGroupMember.updateMany).not.toHaveBeenCalled();
    });
  });
});
