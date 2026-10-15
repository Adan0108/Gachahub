import type { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { ChatRepository } from './chat.repository';

describe('ChatRepository receipts', () => {
  const tx = {
    chatMessageReceipt: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
    chatMessage: { findFirst: jest.fn() },
    chatParticipant: { update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((run: (client: unknown) => unknown) => run(tx)),
    chatParticipant: { findMany: jest.fn() },
    chatMessage: { findUnique: jest.fn() },
  };
  const repository = new ChatRepository(
    prisma as unknown as PrismaService,
    {} as MlsGroupRosterRepository,
  );

  beforeEach(() => jest.clearAllMocks());

  describe('markMessagesDelivered', () => {
    const pending = [
      { id: 'r1', messageId: 'm1', message: { conversationId: 'c1' } },
      { id: 'r2', messageId: 'm2', message: { conversationId: 'c2' } },
    ];

    it('marks only the receipts that were not delivered yet, and says which', async () => {
      tx.chatMessageReceipt.findMany.mockResolvedValue(pending);
      tx.chatMessageReceipt.updateManyAndReturn.mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
      ]);

      const result = await repository.markMessagesDelivered('user-1', [
        'm1',
        'm2',
        'm3',
      ]);

      expect(tx.chatMessageReceipt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            messageId: { in: ['m1', 'm2', 'm3'] },
            deliveredAt: null,
          },
        }),
      );
      expect(tx.chatMessageReceipt.updateManyAndReturn).toHaveBeenCalledWith({
        where: { id: { in: ['r1', 'r2'] }, deliveredAt: null },
        data: { deliveredAt: expect.any(Date) as unknown },
        select: { id: true },
      });
      expect(result).toEqual([
        { messageId: 'm1', conversationId: 'c1' },
        { messageId: 'm2', conversationId: 'c2' },
      ]);
    });

    it('reports only what this call changed when another device got there first', async () => {
      tx.chatMessageReceipt.findMany.mockResolvedValue(pending);
      // the update skipped r1: it was marked delivered between the read and the write
      tx.chatMessageReceipt.updateManyAndReturn.mockResolvedValue([
        { id: 'r2' },
      ]);

      const result = await repository.markMessagesDelivered('user-1', [
        'm1',
        'm2',
      ]);

      expect(result).toEqual([{ messageId: 'm2', conversationId: 'c2' }]);
    });

    it('does not touch anything when everything was already delivered', async () => {
      tx.chatMessageReceipt.findMany.mockResolvedValue([]);

      await expect(
        repository.markMessagesDelivered('user-1', ['m1']),
      ).resolves.toEqual([]);
      expect(tx.chatMessageReceipt.updateManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe('findMessageBySenderClientMessageId', () => {
    it("only brings back the sender's own receipt, so a resend cannot reveal anyone's read time", async () => {
      await repository.findMessageBySenderClientMessageId('user-1', 'client-1');

      expect(prisma.chatMessage.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            receipts: { where: { userId: 'user-1' } },
          }) as unknown,
        }),
      );
    });

    it('looks nothing up without a client message id', () => {
      expect(
        repository.findMessageBySenderClientMessageId('user-1', undefined),
      ).toBeNull();
      expect(prisma.chatMessage.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('markConversationRead', () => {
    const lastRead = {
      id: 'm5',
      createdAt: new Date('2026-10-06T10:00:00.000Z'),
    };

    it('returns how many were newly read and up to which message', async () => {
      tx.chatMessage.findFirst.mockResolvedValue(lastRead);
      tx.chatMessageReceipt.updateManyAndReturn.mockResolvedValue([
        { messageId: 'm3' },
        { messageId: 'm4' },
        { messageId: 'm5' },
      ]);

      const result = await repository.markConversationRead({
        conversationId: 'c1',
        userId: 'user-1',
        lastReadMessageId: 'm5',
      });

      expect(result).toEqual({
        count: 3,
        lastReadMessage: lastRead,
        readMessageIds: ['m3', 'm4', 'm5'],
      });
      expect(tx.chatParticipant.update).toHaveBeenCalled();
    });

    it('reports nothing read when the message is not there', async () => {
      tx.chatMessage.findFirst.mockResolvedValue(null);

      await expect(
        repository.markConversationRead({
          conversationId: 'c1',
          userId: 'user-1',
          lastReadMessageId: 'gone',
        }),
      ).resolves.toEqual({
        count: 0,
        lastReadMessage: null,
        readMessageIds: [],
      });
      expect(tx.chatMessageReceipt.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('never picks a hidden edit as the latest message to read up to', async () => {
      tx.chatMessage.findFirst.mockResolvedValue(lastRead);
      tx.chatMessageReceipt.updateManyAndReturn.mockResolvedValue([
        { messageId: 'm5' },
      ]);

      await repository.markConversationRead({
        conversationId: 'c1',
        userId: 'user-1',
      });

      expect(tx.chatMessage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'c1', contentType: { not: 'EDIT' } },
        }),
      );
    });
  });

  it('lists everyone in a conversation with their read receipt setting', async () => {
    await repository.findReceiptParties('c1');

    expect(prisma.chatParticipant.findMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1' },
      select: {
        userId: true,
        state: true,
        deletedAt: true,
        user: { select: { sendReadReceipts: true } },
      },
    });
  });
});
