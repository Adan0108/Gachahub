import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
jest.mock('./chat.repository', () => ({ ChatRepository: class {} }));
jest.mock('../follows/follows.service', () => ({ FollowsService: class {} }));
jest.mock('../blocks/blocks.service', () => ({ BlocksService: class {} }));
jest.mock('../game-moderators/game-moderators.service', () => ({
  GameModeratorsService: class {},
}));

import type { ChatParticipantState } from '../generated/prisma/client';
import { ChatAccessService } from './chat-access.service';
import { ChatReceiptsService } from './chat-receipts.service';

describe('ChatReceiptsService', () => {
  const repository = {
    findParticipant: jest.fn(),
    markMessagesDelivered: jest.fn(),
    markConversationRead: jest.fn(),
    findReceiptParties: jest.fn(),
  };
  const chatDelivery = { publishReceiptsUpdated: jest.fn() };
  const notifications = { markMessageNotificationsAsRead: jest.fn() };

  let service: ChatReceiptsService;

  const row = (
    userId: string,
    overrides: Partial<{
      state: ChatParticipantState;
      deletedAt: Date | null;
      sendReadReceipts: boolean;
    }> = {},
  ) => ({
    userId,
    state: overrides.state ?? 'ACTIVE',
    deletedAt: overrides.deletedAt ?? null,
    user: { sendReadReceipts: overrides.sendReadReceipts ?? true },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    const access = new ChatAccessService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    service = new ChatReceiptsService(
      repository as never,
      access,
      chatDelivery as never,
      notifications as never,
    );
    repository.findReceiptParties.mockResolvedValue([]);
    notifications.markMessageNotificationsAsRead.mockResolvedValue({
      count: 0,
    });
  });

  describe('markDelivered', () => {
    it('marks the given message ids delivered and returns how many were new', async () => {
      repository.markMessagesDelivered.mockResolvedValue([
        { messageId: 'message-1', conversationId: 'conversation-1' },
        { messageId: 'message-2', conversationId: 'conversation-1' },
        { messageId: 'message-3', conversationId: 'conversation-1' },
      ]);

      const result = await service.markDelivered('user-1', {
        messageIds: ['message-1', 'message-2', 'message-3'],
      });

      expect(repository.markMessagesDelivered).toHaveBeenCalledWith('user-1', [
        'message-1',
        'message-2',
        'message-3',
      ]);
      expect(result).toEqual({ deliveredCount: 3 });
    });

    it('tells the other people in the conversation which messages were delivered, with no time', async () => {
      repository.markMessagesDelivered.mockResolvedValue([
        { messageId: 'message-1', conversationId: 'conversation-1' },
        { messageId: 'message-2', conversationId: 'conversation-1' },
      ]);
      repository.findReceiptParties.mockResolvedValue([
        row('user-1'),
        row('user-2'),
      ]);

      await service.markDelivered('user-1', {
        messageIds: ['message-1', 'message-2'],
      });

      expect(chatDelivery.publishReceiptsUpdated).toHaveBeenCalledTimes(1);
      expect(chatDelivery.publishReceiptsUpdated).toHaveBeenCalledWith({
        kind: 'delivered',
        conversationId: 'conversation-1',
        readerId: 'user-1',
        recipientUserIds: ['user-2'],
        messageIds: ['message-1', 'message-2'],
      });
    });

    it('sends one event per conversation', async () => {
      repository.markMessagesDelivered.mockResolvedValue([
        { messageId: 'message-1', conversationId: 'conversation-1' },
        { messageId: 'message-2', conversationId: 'conversation-2' },
      ]);
      repository.findReceiptParties.mockResolvedValue([
        row('user-1'),
        row('user-2'),
      ]);

      await service.markDelivered('user-1', {
        messageIds: ['message-1', 'message-2'],
      });

      expect(chatDelivery.publishReceiptsUpdated).toHaveBeenCalledTimes(2);
    });

    it('announces every conversation at once, not one after another', async () => {
      repository.markMessagesDelivered.mockResolvedValue([
        { messageId: 'message-1', conversationId: 'conversation-1' },
        { messageId: 'message-2', conversationId: 'conversation-2' },
      ]);
      repository.findReceiptParties.mockResolvedValue([
        row('user-1'),
        row('user-2'),
      ]);
      let releaseFirst: () => void = () => undefined;
      chatDelivery.publishReceiptsUpdated.mockImplementationOnce(
        () => new Promise<void>((resolve) => (releaseFirst = resolve)),
      );

      const done = service.markDelivered('user-1', {
        messageIds: ['message-1', 'message-2'],
      });
      await new Promise((resolve) => setImmediate(resolve));

      // the first announcement is still waiting, and the second has gone out anyway
      expect(chatDelivery.publishReceiptsUpdated).toHaveBeenCalledTimes(2);
      releaseFirst();
      await done;
    });

    it('stays quiet when nothing was newly delivered', async () => {
      repository.markMessagesDelivered.mockResolvedValue([]);

      const result = await service.markDelivered('user-1', {
        messageIds: ['message-1'],
      });

      expect(result).toEqual({ deliveredCount: 0 });
      expect(chatDelivery.publishReceiptsUpdated).not.toHaveBeenCalled();
    });

    it('still shows delivery when the reader has read receipts off', async () => {
      repository.markMessagesDelivered.mockResolvedValue([
        { messageId: 'message-1', conversationId: 'conversation-1' },
      ]);
      repository.findReceiptParties.mockResolvedValue([
        row('user-1', { sendReadReceipts: false }),
        row('user-2'),
      ]);

      await service.markDelivered('user-1', { messageIds: ['message-1'] });

      expect(chatDelivery.publishReceiptsUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserIds: ['user-2'] }),
      );
    });

    it('does not tell people who left the conversation or declined it', async () => {
      repository.markMessagesDelivered.mockResolvedValue([
        { messageId: 'message-1', conversationId: 'conversation-1' },
      ]);
      repository.findReceiptParties.mockResolvedValue([
        row('user-1'),
        row('user-2', { deletedAt: new Date() }),
        row('user-3', { state: 'DECLINED' }),
      ]);

      await service.markDelivered('user-1', { messageIds: ['message-1'] });

      expect(chatDelivery.publishReceiptsUpdated).not.toHaveBeenCalled();
    });

    describe('when announcing goes wrong', () => {
      let warn: jest.SpyInstance;
      beforeEach(() => {
        warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
        repository.markMessagesDelivered.mockResolvedValue([
          { messageId: 'message-1', conversationId: 'conversation-1' },
        ]);
      });
      afterEach(() => warn.mockRestore());

      it('does not fail the request when the socket fails, the receipts are already saved', async () => {
        repository.findReceiptParties.mockResolvedValue([
          row('user-1'),
          row('user-2'),
        ]);
        chatDelivery.publishReceiptsUpdated.mockRejectedValue(
          new Error('socket down'),
        );

        await expect(
          service.markDelivered('user-1', { messageIds: ['message-1'] }),
        ).resolves.toEqual({ deliveredCount: 1 });

        expect(warn).toHaveBeenCalled();
      });

      it('does not fail the request when looking up who to tell fails', async () => {
        repository.findReceiptParties.mockRejectedValue(new Error('db blip'));

        await expect(
          service.markDelivered('user-1', { messageIds: ['message-1'] }),
        ).resolves.toEqual({ deliveredCount: 1 });

        expect(warn).toHaveBeenCalled();
      });

      it('still announces the other conversations when one fails', async () => {
        repository.markMessagesDelivered.mockResolvedValue([
          { messageId: 'message-1', conversationId: 'conversation-1' },
          { messageId: 'message-2', conversationId: 'conversation-2' },
        ]);
        repository.findReceiptParties
          .mockRejectedValueOnce(new Error('db blip'))
          .mockResolvedValueOnce([row('user-1'), row('user-2')]);

        await service.markDelivered('user-1', {
          messageIds: ['message-1', 'message-2'],
        });

        expect(chatDelivery.publishReceiptsUpdated).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('markRead', () => {
    const activeParticipant = { userId: 'user-1', state: 'ACTIVE' };
    const readUpTo5 = {
      count: 1,
      lastReadMessage: { id: 'message-5' },
      readMessageIds: ['message-5'],
    };
    const read = () =>
      service.markRead('user-1', 'conversation-1', {
        lastReadMessageId: 'message-5',
      });

    it('rejects when the conversation is not found', async () => {
      repository.findParticipant.mockResolvedValue(null);

      await expect(
        service.markRead('user-1', 'conversation-1', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an unreadable participant state', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'BLOCKED',
      });

      await expect(
        service.markRead('user-1', 'conversation-1', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('marks the conversation read and returns the count', async () => {
      repository.findParticipant.mockResolvedValue(activeParticipant);
      repository.markConversationRead.mockResolvedValue({
        count: 5,
        lastReadMessage: { id: 'message-5' },
        readMessageIds: ['message-1', 'message-5'],
      });

      const result = await read();

      expect(repository.markConversationRead).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        userId: 'user-1',
        lastReadMessageId: 'message-5',
      });
      expect(result).toEqual({ readCount: 5 });
    });

    it('tells the people allowed to see it how far this user has read', async () => {
      repository.findParticipant.mockResolvedValue(activeParticipant);
      repository.markConversationRead.mockResolvedValue(readUpTo5);
      repository.findReceiptParties.mockResolvedValue([
        row('user-1'),
        row('user-2'),
      ]);

      await read();

      expect(chatDelivery.publishReceiptsUpdated).toHaveBeenCalledWith({
        kind: 'read',
        conversationId: 'conversation-1',
        readerId: 'user-1',
        recipientUserIds: ['user-2'],
        upToMessageId: 'message-5',
        at: expect.any(Date) as unknown,
      });
    });

    it('settles the notifications of the messages just read', async () => {
      repository.findParticipant.mockResolvedValue(activeParticipant);
      repository.markConversationRead.mockResolvedValue({
        ...readUpTo5,
        readMessageIds: ['message-4', 'message-5'],
      });

      await read();

      expect(notifications.markMessageNotificationsAsRead).toHaveBeenCalledWith(
        'user-1',
        ['message-4', 'message-5'],
      );
    });

    it('still succeeds and announces when the notifications cannot be settled', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      repository.findParticipant.mockResolvedValue(activeParticipant);
      repository.markConversationRead.mockResolvedValue(readUpTo5);
      repository.findReceiptParties.mockResolvedValue([
        row('user-1'),
        row('user-2'),
      ]);
      notifications.markMessageNotificationsAsRead.mockRejectedValue(
        new Error('db blip'),
      );

      await expect(read()).resolves.toEqual({ readCount: 1 });

      expect(chatDelivery.publishReceiptsUpdated).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    });

    it('does not announce a read that changed nothing', async () => {
      repository.findParticipant.mockResolvedValue(activeParticipant);
      repository.markConversationRead.mockResolvedValue({
        count: 0,
        lastReadMessage: { id: 'message-5' },
        readMessageIds: [],
      });

      await read();

      expect(chatDelivery.publishReceiptsUpdated).not.toHaveBeenCalled();
    });

    it('does not announce anything when there is no message to read', async () => {
      repository.findParticipant.mockResolvedValue(activeParticipant);
      repository.markConversationRead.mockResolvedValue({
        count: 0,
        lastReadMessage: null,
        readMessageIds: [],
      });

      await service.markRead('user-1', 'conversation-1', {});

      expect(chatDelivery.publishReceiptsUpdated).not.toHaveBeenCalled();
    });

    it.each<
      [string, { sendReadReceipts?: boolean; state?: ChatParticipantState }]
    >([
      ['has read receipts off', { sendReadReceipts: false }],
      ['has not accepted the conversation yet', { state: 'PENDING' }],
    ])(
      'keeps a read secret when the reader %s',
      async (_name, readerOverrides) => {
        repository.findParticipant.mockResolvedValue(activeParticipant);
        repository.markConversationRead.mockResolvedValue(readUpTo5);
        repository.findReceiptParties.mockResolvedValue([
          row('user-1', readerOverrides),
          row('user-2'),
        ]);

        await read();

        expect(chatDelivery.publishReceiptsUpdated).not.toHaveBeenCalled();
      },
    );

    it('does not tell someone who has receipts off themselves (it is mutual)', async () => {
      repository.findParticipant.mockResolvedValue(activeParticipant);
      repository.markConversationRead.mockResolvedValue(readUpTo5);
      repository.findReceiptParties.mockResolvedValue([
        row('user-1'),
        row('user-2', { sendReadReceipts: false }),
        row('user-3'),
      ]);

      await read();

      expect(chatDelivery.publishReceiptsUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserIds: ['user-3'] }),
      );
    });

    it('does not fail marking read when announcing it fails', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      repository.findParticipant.mockResolvedValue(activeParticipant);
      repository.markConversationRead.mockResolvedValue(readUpTo5);
      repository.findReceiptParties.mockResolvedValue([
        row('user-1'),
        row('user-2'),
      ]);
      chatDelivery.publishReceiptsUpdated.mockRejectedValue(
        new Error('socket down'),
      );

      await expect(read()).resolves.toEqual({ readCount: 1 });

      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
