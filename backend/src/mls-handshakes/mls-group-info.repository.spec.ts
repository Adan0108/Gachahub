import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { MlsGroupInfoRepository } from './mls-group-info.repository';

describe('MlsGroupInfoRepository', () => {
  const db = {
    mlsGroupInfo: {
      updateMany: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn(),
    },
    chatConversation: { findUnique: jest.fn() },
  };
  let repository: MlsGroupInfoRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new MlsGroupInfoRepository(db as unknown as PrismaService);
  });

  describe('describesEpoch', () => {
    it('is true only when a snapshot for exactly that epoch is stored', async () => {
      db.mlsGroupInfo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await expect(repository.describesEpoch('conv-1', 5)).resolves.toBe(true);
      await expect(repository.describesEpoch('conv-1', 5)).resolves.toBe(false);
      expect(db.mlsGroupInfo.count).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', epoch: 5 },
      });
    });
  });

  describe('save', () => {
    it('replaces an older snapshot without creating a second row', async () => {
      db.mlsGroupInfo.updateMany.mockResolvedValue({ count: 1 });

      await repository.save('conv-1', 4, new Uint8Array([1]));

      expect(db.mlsGroupInfo.updateMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', epoch: { lt: 4 } },
        data: { epoch: 4, payload: new Uint8Array([1]) },
      });
      expect(db.mlsGroupInfo.createMany).not.toHaveBeenCalled();
    });

    it('creates the first snapshot, and never overwrites a newer one', async () => {
      db.mlsGroupInfo.updateMany.mockResolvedValue({ count: 0 });

      await repository.save('conv-1', 4, new Uint8Array([1]));

      expect(db.mlsGroupInfo.createMany).toHaveBeenCalledWith({
        data: [
          { conversationId: 'conv-1', epoch: 4, payload: new Uint8Array([1]) },
        ],
        skipDuplicates: true,
      });
    });

    it('writes through the transaction it is given', async () => {
      const tx = {
        mlsGroupInfo: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          createMany: jest.fn(),
        },
      };

      await repository.save('conv-1', 2, new Uint8Array([1]), tx as never);

      expect(tx.mlsGroupInfo.updateMany).toHaveBeenCalled();
      expect(db.mlsGroupInfo.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('findCurrent', () => {
    it('returns the snapshot while it describes the current epoch', async () => {
      const info = { epoch: 4, payload: new Uint8Array([1]) };
      db.chatConversation.findUnique.mockResolvedValue({
        mlsEpoch: 4,
        mlsGroupInfo: info,
      });

      await expect(repository.findCurrent('conv-1')).resolves.toBe(info);
    });

    it('returns nothing when the group has moved on, or there is no snapshot, or no conversation', async () => {
      db.chatConversation.findUnique.mockResolvedValueOnce({
        mlsEpoch: 5,
        mlsGroupInfo: { epoch: 4, payload: new Uint8Array() },
      });
      db.chatConversation.findUnique.mockResolvedValueOnce({
        mlsEpoch: 5,
        mlsGroupInfo: null,
      });
      db.chatConversation.findUnique.mockResolvedValueOnce(null);

      await expect(repository.findCurrent('conv-1')).resolves.toBeNull();
      await expect(repository.findCurrent('conv-1')).resolves.toBeNull();
      await expect(repository.findCurrent('conv-1')).resolves.toBeNull();
    });
  });
});
