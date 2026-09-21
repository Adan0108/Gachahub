import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
jest.mock('./chat.repository', () => ({
  ChatRepository: class {},
}));
jest.mock('../follows/follows.service', () => ({
  FollowsService: class {},
}));
jest.mock('../games/games.service', () => ({
  GamesService: class {},
}));
jest.mock('../game-moderators/game-moderators.service', () => ({
  GameModeratorsService: class {},
}));
jest.mock('../blocks/blocks.service', () => ({
  BlocksService: class {},
}));
jest.mock('../media/media.service', () => ({
  MediaService: class {},
}));
// real Prisma namespace, not a stub - the code under test checks `instanceof`
// Prisma.PrismaClientKnownRequestError, which only works against the same class
function loadActualPrisma() {
  const actual: { Prisma: typeof import('../generated/prisma/client').Prisma } =
    jest.requireActual('../generated/prisma/client');
  return actual.Prisma;
}

jest.mock('../generated/prisma/client', () => ({
  ChatMessageContentType: { TEXT: 'TEXT' },
  UserRole: { ADMIN: 'ADMIN' },
  Prisma: loadActualPrisma(),
}));

import { ChatAccessService } from './chat-access.service';
import { ChatMessageActionsService } from './chat-message-actions.service';

describe('ChatMessageActionsService', () => {
  const repository = {
    findActiveUsersByIds: jest.fn(),
    createGroupConversation: jest.fn(),
    updateGroupConversation: jest.fn(),
    addGroupMembers: jest.fn(),
    removeGroupMembers: jest.fn(),
    findConversationWithParticipants: jest.fn(),
    findParticipant: jest.fn(),
    transferGroupOwnership: jest.fn(),
    updateParticipantRole: jest.fn(),
    findUserById: jest.fn(),
    findDirectPair: jest.fn(),
    createDirectConversationWithMessage: jest.fn(),
    findMessageBySenderClientMessageId: jest.fn(),
    findParticipants: jest.fn(),
    findSentMessageInConversation: jest.fn(),
    createMessage: jest.fn(),
    updateParticipantArchivedState: jest.fn(),
    createGameChatEmote: jest.fn(),
    findMessageWithParticipants: jest.fn(),
    upsertMessageReaction: jest.fn(),
    findUsableChatEmote: jest.fn(),
    deleteMessageReaction: jest.fn(),
    updateParticipantState: jest.fn(),
    updateParticipantNotificationLevel: jest.fn(),
    updateParticipantPinnedAt: jest.fn(),
    markMessagesDelivered: jest.fn(),
    markConversationRead: jest.fn(),
    updateMessage: jest.fn(),
    softDeleteMessage: jest.fn(),
    findInboxConversations: jest.fn(),
    findConversationType: jest.fn(),
    countUnreadMessagesForConversations: jest.fn(),
    countUnreadMessagesForUser: jest.fn(),
    countUnreadConversationsForUser: jest.fn(),
    findMessages: jest.fn(),
    softDeleteConversationForParticipant: jest.fn(),
    restoreDeletedParticipants: jest.fn(),
    deleteMessageMediaByUploadId: jest.fn(),
    finalizeReleasedMedia: jest.fn(),
  };

  const followsService = {
    isFollowing: jest.fn(),
  };

  const blocksService = {
    isBlocked: jest.fn(),
    getBlockedIdsAmong: jest.fn(),
    block: jest.fn(),
    unblock: jest.fn(),
  };

  const gamesService = {
    findById: jest.fn(),
  };

  const gameModeratorsService = {
    isModerator: jest.fn(),
  };

  const mediaService = {
    resolveAttachableMedia: jest.fn(),
    releaseAttachedUpload: jest.fn(),
    destroyAttachedCloudinaryAsset: jest.fn(),
    markReleaseFailed: jest.fn().mockResolvedValue(undefined),
  };

  const chatDelivery = {
    publishMessageCreated: jest.fn(),
    publishMessageEdited: jest.fn(),
    publishMessageDeleted: jest.fn(),
    publishReactionAdded: jest.fn(),
    publishReactionRemoved: jest.fn(),
  };

  let chatAccessService: ChatAccessService;
  let service: ChatMessageActionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    chatAccessService = new ChatAccessService(
      repository as any,
      followsService as any,
      blocksService as any,
      gameModeratorsService as any,
    );
    service = new ChatMessageActionsService(
      repository as any,
      chatAccessService,
      gamesService as any,
      mediaService as any,
      chatDelivery,
    );
    blocksService.getBlockedIdsAmong.mockResolvedValue(new Set());
    blocksService.isBlocked.mockResolvedValue(false);
    followsService.isFollowing.mockResolvedValue({ following: false });
    repository.countUnreadMessagesForConversations.mockResolvedValue([]);
  });

  describe('createGameEmote', () => {
    it('rejects when the game does not exist', async () => {
      gamesService.findById.mockResolvedValue(null);

      await expect(
        service.createGameEmote('user-1', 'game-1', {
          shortcode: 'catcooking',
          unicode: '\\u{1F639}',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a caller who is neither admin nor game moderator', async () => {
      gamesService.findById.mockResolvedValue({ id: 'game-1' });
      repository.findUserById.mockResolvedValue({ id: 'user-1', role: 'USER' });
      gameModeratorsService.isModerator.mockResolvedValue(false);

      await expect(
        service.createGameEmote('user-1', 'game-1', {
          shortcode: 'catcooking',
          unicode: '\\u{1F639}',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an app admin regardless of moderator assignment', async () => {
      gamesService.findById.mockResolvedValue({ id: 'game-1' });
      repository.findUserById.mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
      });
      repository.createGameChatEmote.mockResolvedValue({ id: 'emote-1' });

      await service.createGameEmote('user-1', 'game-1', {
        shortcode: 'catcooking',
        unicode: '\\u{1F639}',
      });

      expect(gameModeratorsService.isModerator).not.toHaveBeenCalled();
      expect(repository.createGameChatEmote).toHaveBeenCalled();
    });

    it('allows an assigned game moderator', async () => {
      gamesService.findById.mockResolvedValue({ id: 'game-1' });
      repository.findUserById.mockResolvedValue({ id: 'user-1', role: 'USER' });
      gameModeratorsService.isModerator.mockResolvedValue(true);
      repository.createGameChatEmote.mockResolvedValue({ id: 'emote-1' });

      await service.createGameEmote('user-1', 'game-1', {
        shortcode: 'catcooking',
        unicode: '\\u{1F639}',
      });

      expect(repository.createGameChatEmote).toHaveBeenCalled();
    });

    it('rejects an emote with no renderable value', async () => {
      gamesService.findById.mockResolvedValue({ id: 'game-1' });
      repository.findUserById.mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
      });

      await expect(
        service.createGameEmote('user-1', 'game-1', {
          shortcode: 'catcooking',
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(repository.createGameChatEmote).not.toHaveBeenCalled();
    });

    it('creates the emote with the given fields on success', async () => {
      gamesService.findById.mockResolvedValue({ id: 'game-1' });
      repository.findUserById.mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
      });
      repository.createGameChatEmote.mockResolvedValue({ id: 'emote-1' });

      await service.createGameEmote('user-1', 'game-1', {
        shortcode: 'catcooking',
        imageUrl: 'https://cdn.example.com/catcooking.png',
      });

      expect(repository.createGameChatEmote).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: 'game-1',
          createdById: 'user-1',
          shortcode: 'catcooking',
          imageUrl: 'https://cdn.example.com/catcooking.png',
        }),
      );
    });
  });

  describe('reactToMessage', () => {
    const sentMessage = (
      participants: Array<{ userId: string; state: string }>,
    ) => ({
      id: 'message-1',
      status: 'SENT',
      conversation: { participants },
    });

    it('rejects when the message does not exist or is not sent', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(null);

      await expect(
        service.reactToMessage('user-1', 'message-1', { emoji: '😋' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a caller who is not a readable participant', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        sentMessage([{ userId: 'user-2', state: 'ACTIVE' }]),
      );

      await expect(
        service.reactToMessage('user-1', 'message-1', { emoji: '😋' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a reaction with neither emoji nor emoteId', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        sentMessage([{ userId: 'user-1', state: 'ACTIVE' }]),
      );

      await expect(
        service.reactToMessage('user-1', 'message-1', {} as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a reaction with both emoji and emoteId', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        sentMessage([{ userId: 'user-1', state: 'ACTIVE' }]),
      );

      await expect(
        service.reactToMessage('user-1', 'message-1', {
          emoji: '😋',
          emoteId: 'emote-1',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('upserts an emoji reaction without checking custom emote usability', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        sentMessage([{ userId: 'user-1', state: 'ACTIVE' }]),
      );
      repository.upsertMessageReaction.mockResolvedValue({ id: 'reaction-1' });

      await service.reactToMessage('user-1', 'message-1', {
        emoji: '😋',
      });

      expect(repository.findUsableChatEmote).not.toHaveBeenCalled();
      expect(repository.upsertMessageReaction).toHaveBeenCalledWith({
        messageId: 'message-1',
        userId: 'user-1',
        emoji: '😋',
        emoteId: null,
      });
    });

    it('rejects a custom emote the caller cannot use', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        sentMessage([{ userId: 'user-1', state: 'ACTIVE' }]),
      );
      repository.findUsableChatEmote.mockResolvedValue(null);

      await expect(
        service.reactToMessage('user-1', 'message-1', {
          emoteId: 'emote-1',
        } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.upsertMessageReaction).not.toHaveBeenCalled();
    });

    it('upserts a custom emote reaction on success', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(
        sentMessage([{ userId: 'user-1', state: 'ACTIVE' }]),
      );
      repository.findUsableChatEmote.mockResolvedValue({ id: 'emote-1' });
      repository.upsertMessageReaction.mockResolvedValue({ id: 'reaction-1' });

      await service.reactToMessage('user-1', 'message-1', {
        emoteId: 'emote-1',
      });

      expect(repository.upsertMessageReaction).toHaveBeenCalledWith({
        messageId: 'message-1',
        userId: 'user-1',
        emoji: null,
        emoteId: 'emote-1',
      });
    });

    it('publishes a reaction-added event with the deliverable recipients', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
        status: 'SENT',
        conversation: {
          type: 'DIRECT',
          participants: [
            { userId: 'user-1', state: 'ACTIVE', deletedAt: null },
            { userId: 'user-2', state: 'ACTIVE', deletedAt: null },
          ],
        },
      });
      repository.upsertMessageReaction.mockResolvedValue({ id: 'reaction-1' });

      await service.reactToMessage('user-1', 'message-1', { emoji: '😋' });

      expect(chatDelivery.publishReactionAdded).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        actorId: 'user-1',
        recipientUserIds: ['user-2'],
      });
    });

    it('excludes the actor, PENDING group members, and deleted participants from the reaction event', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
        status: 'SENT',
        conversation: {
          type: 'GROUP',
          participants: [
            { userId: 'user-1', state: 'ACTIVE', deletedAt: null },
            { userId: 'user-2', state: 'ACTIVE', deletedAt: null },
            { userId: 'user-3', state: 'PENDING', deletedAt: null },
            { userId: 'user-4', state: 'ACTIVE', deletedAt: new Date() },
          ],
        },
      });
      repository.upsertMessageReaction.mockResolvedValue({ id: 'reaction-1' });

      await service.reactToMessage('user-1', 'message-1', { emoji: '😋' });

      expect(chatDelivery.publishReactionAdded).toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserIds: ['user-2'] }),
      );
    });
  });

  describe('removeReaction', () => {
    it('rejects when the message does not exist or is not sent', async () => {
      repository.findMessageWithParticipants.mockResolvedValue(null);

      await expect(
        service.removeReaction('user-1', 'message-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a caller who is not a readable participant', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        status: 'SENT',
        conversation: {
          participants: [{ userId: 'user-2', state: 'ACTIVE' }],
        },
      });

      await expect(
        service.removeReaction('user-1', 'message-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('removes the reaction and returns the count on success', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        status: 'SENT',
        conversation: {
          participants: [{ userId: 'user-1', state: 'ACTIVE' }],
        },
      });
      repository.deleteMessageReaction.mockResolvedValue({ count: 1 });

      const result = await service.removeReaction('user-1', 'message-1');

      expect(repository.deleteMessageReaction).toHaveBeenCalledWith(
        'message-1',
        'user-1',
      );
      expect(result).toEqual({ removedCount: 1 });
    });

    it('publishes a reaction-removed event when a reaction was removed', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
        status: 'SENT',
        conversation: {
          type: 'DIRECT',
          participants: [
            { userId: 'user-1', state: 'ACTIVE', deletedAt: null },
            { userId: 'user-2', state: 'ACTIVE', deletedAt: null },
          ],
        },
      });
      repository.deleteMessageReaction.mockResolvedValue({ count: 1 });

      await service.removeReaction('user-1', 'message-1');

      expect(chatDelivery.publishReactionRemoved).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        actorId: 'user-1',
        recipientUserIds: ['user-2'],
      });
    });

    it('does not publish anything when there was no reaction to remove', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
        status: 'SENT',
        conversation: {
          type: 'DIRECT',
          participants: [
            { userId: 'user-1', state: 'ACTIVE', deletedAt: null },
          ],
        },
      });
      repository.deleteMessageReaction.mockResolvedValue({ count: 0 });

      await service.removeReaction('user-1', 'message-1');

      expect(chatDelivery.publishReactionRemoved).not.toHaveBeenCalled();
    });
  });

  describe('editMessage / deleteMessage (permission)', () => {
    const modifyMessageMethods: Array<{
      name: string;
      call: (userId: string, messageId: string) => Promise<unknown>;
    }> = [
      {
        name: 'editMessage',
        call: (u, m) => service.editMessage(u, m, { ciphertext: 'new-cipher' }),
      },
      { name: 'deleteMessage', call: (u, m) => service.deleteMessage(u, m) },
    ];

    it.each(modifyMessageMethods)(
      '$name rejects when the message does not exist or is not sent',
      async ({ call }) => {
        repository.findMessageWithParticipants.mockResolvedValue(null);

        await expect(call('user-1', 'message-1')).rejects.toThrow(
          NotFoundException,
        );
      },
    );

    it.each(modifyMessageMethods)(
      '$name rejects a caller who is not the sender',
      async ({ call }) => {
        repository.findMessageWithParticipants.mockResolvedValue({
          id: 'message-1',
          status: 'SENT',
          senderId: 'user-2',
          conversation: {
            participants: [{ userId: 'user-1', state: 'ACTIVE' }],
          },
        });

        await expect(call('user-1', 'message-1')).rejects.toThrow(
          ForbiddenException,
        );
      },
    );

    it.each(modifyMessageMethods)(
      '$name rejects a caller who cannot read the conversation',
      async ({ call }) => {
        repository.findMessageWithParticipants.mockResolvedValue({
          id: 'message-1',
          status: 'SENT',
          senderId: 'user-1',
          conversation: {
            participants: [{ userId: 'user-1', state: 'BLOCKED' }],
          },
        });

        await expect(call('user-1', 'message-1')).rejects.toThrow(
          ForbiddenException,
        );
      },
    );
  });

  describe('editMessage', () => {
    it('updates the message on success', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        status: 'SENT',
        senderId: 'user-1',
        conversation: {
          participants: [{ userId: 'user-1', state: 'ACTIVE' }],
        },
      });
      repository.updateMessage.mockResolvedValue({
        id: 'message-1',
        ciphertext: 'new-cipher',
      });

      await service.editMessage('user-1', 'message-1', {
        ciphertext: 'new-cipher',
        contentType: 'IMAGE',
      } as any);

      expect(repository.updateMessage).toHaveBeenCalledWith({
        messageId: 'message-1',
        ciphertext: 'new-cipher',
        encryptionMeta: undefined,
        contentType: 'IMAGE',
      });
    });

    it('publishes a message-edited event with the deliverable recipients', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
        status: 'SENT',
        senderId: 'user-1',
        conversation: {
          type: 'DIRECT',
          participants: [
            { userId: 'user-1', state: 'ACTIVE', deletedAt: null },
            { userId: 'user-2', state: 'ACTIVE', deletedAt: null },
          ],
        },
      });
      repository.updateMessage.mockResolvedValue({
        id: 'message-1',
        ciphertext: 'new-cipher',
      });

      await service.editMessage('user-1', 'message-1', {
        ciphertext: 'new-cipher',
      });

      expect(chatDelivery.publishMessageEdited).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        actorId: 'user-1',
        recipientUserIds: ['user-2'],
      });
    });
  });

  describe('deleteMessage', () => {
    it('soft deletes the message on success', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        status: 'SENT',
        senderId: 'user-1',
        media: [],
        conversation: {
          participants: [{ userId: 'user-1', state: 'ACTIVE' }],
        },
      });
      repository.softDeleteMessage.mockResolvedValue({ id: 'message-1' });

      const result = await service.deleteMessage('user-1', 'message-1');

      expect(repository.softDeleteMessage).toHaveBeenCalledWith('message-1');
      expect(result).toEqual({ message: 'Message deleted successfully' });
    });

    it('publishes a message-deleted event with the deliverable recipients', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
        status: 'SENT',
        senderId: 'user-1',
        media: [],
        conversation: {
          type: 'DIRECT',
          participants: [
            { userId: 'user-1', state: 'ACTIVE', deletedAt: null },
            { userId: 'user-2', state: 'ACTIVE', deletedAt: null },
          ],
        },
      });
      repository.softDeleteMessage.mockResolvedValue({ id: 'message-1' });

      await service.deleteMessage('user-1', 'message-1');

      expect(chatDelivery.publishMessageDeleted).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        actorId: 'user-1',
        recipientUserIds: ['user-2'],
      });
    });

    it('releases every attached upload and finalizes it atomically', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        status: 'SENT',
        senderId: 'user-1',
        media: [{ mediaUploadId: 'upload-1' }, { mediaUploadId: 'upload-2' }],
        conversation: {
          participants: [{ userId: 'user-1', state: 'ACTIVE' }],
        },
      });
      repository.softDeleteMessage.mockResolvedValue({ id: 'message-1' });
      mediaService.destroyAttachedCloudinaryAsset.mockResolvedValue(true);

      await service.deleteMessage('user-1', 'message-1');

      expect(mediaService.destroyAttachedCloudinaryAsset).toHaveBeenCalledWith(
        'upload-1',
      );
      expect(mediaService.destroyAttachedCloudinaryAsset).toHaveBeenCalledWith(
        'upload-2',
      );
      expect(repository.finalizeReleasedMedia).toHaveBeenCalledWith('upload-1');
      expect(repository.finalizeReleasedMedia).toHaveBeenCalledWith('upload-2');
      expect(repository.deleteMessageMediaByUploadId).not.toHaveBeenCalled();
    });

    it('just unlinks an upload that never needed releasing', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        status: 'SENT',
        senderId: 'user-1',
        media: [{ mediaUploadId: 'upload-1' }],
        conversation: {
          participants: [{ userId: 'user-1', state: 'ACTIVE' }],
        },
      });
      repository.softDeleteMessage.mockResolvedValue({ id: 'message-1' });
      mediaService.destroyAttachedCloudinaryAsset.mockResolvedValue(false);

      await service.deleteMessage('user-1', 'message-1');

      expect(repository.deleteMessageMediaByUploadId).toHaveBeenCalledWith(
        'upload-1',
      );
      expect(repository.finalizeReleasedMedia).not.toHaveBeenCalled();
    });

    it('does not unlink an upload whose release failed, and still processes the rest', async () => {
      repository.findMessageWithParticipants.mockResolvedValue({
        id: 'message-1',
        status: 'SENT',
        senderId: 'user-1',
        media: [{ mediaUploadId: 'upload-1' }, { mediaUploadId: 'upload-2' }],
        conversation: {
          participants: [{ userId: 'user-1', state: 'ACTIVE' }],
        },
      });
      repository.softDeleteMessage.mockResolvedValue({ id: 'message-1' });
      mediaService.destroyAttachedCloudinaryAsset.mockImplementation(
        (mediaUploadId: string) =>
          mediaUploadId === 'upload-1'
            ? Promise.reject(new Error('cloudinary down'))
            : Promise.resolve(true),
      );

      const result = await service.deleteMessage('user-1', 'message-1');

      // the failed release must not block the message delete itself
      expect(result).toEqual({ message: 'Message deleted successfully' });
      expect(repository.finalizeReleasedMedia).not.toHaveBeenCalledWith(
        'upload-1',
      );
      expect(repository.finalizeReleasedMedia).toHaveBeenCalledWith('upload-2');
      expect(mediaService.markReleaseFailed).toHaveBeenCalledWith('upload-1');
      expect(mediaService.markReleaseFailed).not.toHaveBeenCalledWith(
        'upload-2',
      );
    });
  });

  describe('getTypingRecipients', () => {
    it('returns the other active and archived participants', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
        deletedAt: null,
      });
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', deletedAt: null },
        { userId: 'user-2', state: 'ACTIVE', deletedAt: null },
        { userId: 'user-3', state: 'ARCHIVED', deletedAt: null },
        { userId: 'user-4', state: 'BLOCKED', deletedAt: null },
      ]);

      const result = await service.getTypingRecipients(
        'conversation-1',
        'user-1',
      );

      expect(result).toEqual(['user-2', 'user-3']);
    });

    it('excludes a pending participant, whether as caller or recipient', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
        deletedAt: null,
      });
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', deletedAt: null },
        { userId: 'user-2', state: 'PENDING', deletedAt: null },
      ]);

      const result = await service.getTypingRecipients(
        'conversation-1',
        'user-1',
      );

      expect(result).toEqual([]);

      repository.findParticipant.mockResolvedValue({
        userId: 'user-2',
        state: 'PENDING',
        deletedAt: null,
      });

      const resultForPendingCaller = await service.getTypingRecipients(
        'conversation-1',
        'user-2',
      );

      expect(resultForPendingCaller).toEqual([]);
      expect(repository.findParticipants).toHaveBeenCalledTimes(1);
    });

    it('returns empty when the caller is not a participant', async () => {
      repository.findParticipant.mockResolvedValue(null);

      const result = await service.getTypingRecipients(
        'conversation-1',
        'user-1',
      );

      expect(result).toEqual([]);
      expect(repository.findParticipants).not.toHaveBeenCalled();
    });

    it('returns empty when the caller soft-deleted the conversation', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
        deletedAt: new Date(),
      });

      const result = await service.getTypingRecipients(
        'conversation-1',
        'user-1',
      );

      expect(result).toEqual([]);
      expect(repository.findParticipants).not.toHaveBeenCalled();
    });

    it('returns empty when the caller cannot read the conversation', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'BLOCKED',
        deletedAt: null,
      });

      const result = await service.getTypingRecipients(
        'conversation-1',
        'user-1',
      );

      expect(result).toEqual([]);
      expect(repository.findParticipants).not.toHaveBeenCalled();
    });
  });
});
