import type { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { Prisma } from '../generated/prisma/client';
import { ChatRepository } from './chat.repository';

describe('ChatRepository edits', () => {
  const tx = {
    chatMessage: {
      updateMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = {
    chatMessage: { update: jest.fn(), updateMany: jest.fn() },
    chatConversation: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const repository = new ChatRepository(
    prisma as unknown as PrismaService,
    {} as MlsGroupRosterRepository,
  );
  const asTx = tx as never;

  beforeEach(() => jest.clearAllMocks());

  describe('markMessageEdited', () => {
    it('stamps a message that is still sent', async () => {
      tx.chatMessage.updateMany.mockResolvedValue({ count: 1 });
      const at = new Date('2026-10-05T12:00:00.000Z');

      await expect(
        repository.markMessageEdited(asTx, 'message-1', at),
      ).resolves.toBe(true);

      expect(tx.chatMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'message-1', status: 'SENT' },
        data: { editedAt: at },
      });
    });

    it('reports false for a message that is gone or unsent', async () => {
      tx.chatMessage.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.markMessageEdited(asTx, 'message-1', new Date()),
      ).resolves.toBe(false);
    });
  });

  it('counts only the edits that are still there', async () => {
    tx.chatMessage.count.mockResolvedValue(3);

    await expect(
      repository.countEditsOfMessage(asTx, 'message-1'),
    ).resolves.toBe(3);

    expect(tx.chatMessage.count).toHaveBeenCalledWith({
      where: { editsMessageId: 'message-1', status: 'SENT' },
    });
  });

  it('creates the edit as a hidden EDIT message whose receipts are already read by everyone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
    tx.chatMessage.create.mockResolvedValue({ id: 'edit-1' });

    await repository.createEditMessage(asTx, {
      conversationId: 'conversation-1',
      senderId: 'user-1',
      participantUserIds: ['user-1', 'user-2'],
      editsMessageId: 'message-1',
      ciphertext: 'cipher',
      clientMessageId: 'client-1',
    });
    jest.useRealTimers();

    const now = new Date('2026-10-05T12:00:00.000Z');
    expect(tx.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conversation-1',
        senderId: 'user-1',
        contentType: 'EDIT',
        editsMessageId: 'message-1',
        clientMessageId: 'client-1',
        receipts: {
          create: [
            { userId: 'user-1', deliveredAt: now, readAt: now },
            { userId: 'user-2', deliveredAt: now, readAt: now },
          ],
        },
      }) as unknown,
      include: { receipts: true },
    });
  });

  it('unsending a message unsends its edits with it, in one transaction', async () => {
    prisma.chatMessage.update.mockReturnValue('update-message');
    prisma.chatMessage.updateMany.mockReturnValue('update-edits');
    prisma.$transaction.mockResolvedValue([{ id: 'message-1' }, { count: 2 }]);

    await expect(repository.softDeleteMessage('message-1')).resolves.toEqual({
      id: 'message-1',
    });

    const cleared = expect.objectContaining({
      ciphertext: '',
      encryptionMeta: Prisma.JsonNull,
      status: 'DELETED',
    }) as unknown;
    expect(prisma.chatMessage.update).toHaveBeenCalledWith({
      where: { id: 'message-1' },
      data: cleared,
    });
    expect(prisma.chatMessage.updateMany).toHaveBeenCalledWith({
      where: { editsMessageId: 'message-1' },
      data: cleared,
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      'update-message',
      'update-edits',
    ]);
  });

  it('never picks a hidden edit as the last message of a conversation', async () => {
    await repository.findInboxConversations('user-1', 'ACTIVE');

    expect(prisma.chatConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          messages: expect.objectContaining({
            where: { contentType: { not: 'EDIT' } },
            take: 1,
          }) as unknown,
        }) as unknown,
      }),
    );
  });
});
