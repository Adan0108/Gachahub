import {
  BadRequestException,
  ConflictException,
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
jest.mock('../chat-devices/chat-devices.service', () => ({
  ChatDevicesService: class {},
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

import { Prisma } from '../generated/prisma/client';
import { MembershipChangePendingException } from '../common/exceptions/membership-change-pending.exception';
import { ChatAccessService } from './chat-access.service';
import { ChatMessagingService } from './chat-messaging.service';

describe('ChatMessagingService', () => {
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

  const gameModeratorsService = {
    isModerator: jest.fn(),
  };

  const messageEncryption = {
    preparePayload: jest.fn(),
  };

  const chatMessageRateLimiter = {
    assertNotRateLimited: jest.fn(),
  };

  const chatDevicesService = {
    assertSessionLinkedToActiveDevice: jest.fn(),
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
  let service: ChatMessagingService;

  beforeEach(() => {
    jest.clearAllMocks();
    chatAccessService = new ChatAccessService(
      repository as any,
      followsService as any,
      blocksService as any,
      gameModeratorsService as any,
    );
    service = new ChatMessagingService(
      repository as any,
      chatAccessService,
      mediaService as any,
      messageEncryption,
      chatDelivery,
      chatMessageRateLimiter as any,
      chatDevicesService as any,
    );
    blocksService.getBlockedIdsAmong.mockResolvedValue(new Set());
    blocksService.isBlocked.mockResolvedValue(false);
    followsService.isFollowing.mockResolvedValue({ following: false });
    chatDevicesService.assertSessionLinkedToActiveDevice.mockResolvedValue(
      'device-1',
    );
    repository.countUnreadMessagesForConversations.mockResolvedValue([]);
  });

  const groupConversation = (
    participants: Array<{
      userId: string;
      role: string;
      state: string;
      notificationLevel?: 'ALL' | 'NOTHING';
      mutedUntil?: Date | null;
    }>,
  ) => ({
    id: 'conversation-1',
    type: 'GROUP',
    participants,
  });

  const directConversation = (
    participants: Array<{
      userId: string;
      state: string;
      mutedAt?: Date | null;
      notificationLevel?: 'ALL' | 'NOTHING';
      mutedUntil?: Date | null;
      deletedAt?: Date | null;
    }>,
  ) => ({
    id: 'conversation-1',
    type: 'DIRECT',
    participants,
  });

  const uniqueConstraintError = (targetField: string) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: [targetField] },
    });

  describe('createDirectMessage', () => {
    beforeEach(() => {
      messageEncryption.preparePayload.mockResolvedValue({
        ciphertext: 'cipher',
        encryptionMeta: undefined,
      });
    });

    it('rejects a send from a login never linked to a device, before touching the recipient', async () => {
      const notLinked = new Error('session not linked');
      chatDevicesService.assertSessionLinkedToActiveDevice.mockRejectedValue(
        notLinked,
      );

      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toBe(notLinked);

      expect(
        chatDevicesService.assertSessionLinkedToActiveDevice,
      ).toHaveBeenCalledWith('user-1', 'session-1');
      expect(repository.findUserById).not.toHaveBeenCalled();
    });

    it('rejects a send from a revoked device, before touching the recipient', async () => {
      const revoked = new Error('device revoked');
      chatDevicesService.assertSessionLinkedToActiveDevice.mockRejectedValue(
        revoked,
      );

      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toBe(revoked);

      expect(repository.findUserById).not.toHaveBeenCalled();
    });

    it('rejects messaging yourself', async () => {
      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-1',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the recipient does not exist', async () => {
      repository.findUserById.mockResolvedValue(null);

      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the recipient is not active', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'SUSPENDED',
      });

      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the sender has blocked the recipient', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      blocksService.isBlocked.mockResolvedValue(true);

      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns duplicate when the existing message belongs to this same recipient pair', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findDirectPair.mockResolvedValue({
        conversation: { id: 'conversation-1' },
      });
      repository.findMessageBySenderClientMessageId.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
      });

      const result = await service.createDirectMessage('user-1', 'session-1', {
        recipientUserId: 'user-2',
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(result).toEqual({
        conversationId: 'conversation-1',
        message: { id: 'message-1', conversationId: 'conversation-1' },
        duplicate: true,
      });
    });

    it('rejects when the existing clientMessageId belongs to a different recipient', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findDirectPair.mockResolvedValue(null);
      repository.findMessageBySenderClientMessageId.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-from-a-different-recipient',
      });

      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a reply target when there is no existing conversation', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue(null);

      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1', replyToId: 'message-x' },
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(
        repository.createDirectConversationWithMessage,
      ).not.toHaveBeenCalled();
    });

    it('creates a new pending conversation when no direct pair exists', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue(null);
      repository.createDirectConversationWithMessage.mockResolvedValue({
        conversation: { id: 'conversation-1' },
        message: { id: 'message-1' },
      });

      const result = await service.createDirectMessage('user-1', 'session-1', {
        recipientUserId: 'user-2',
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(
        repository.createDirectConversationWithMessage,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          senderId: 'user-1',
          recipientUserId: 'user-2',
          recipientState: 'PENDING',
        }),
      );
      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: ['user-2'],
          shouldNotify: false,
        }),
      );
      expect(result).toEqual({
        conversationId: 'conversation-1',
        message: { id: 'message-1' },
        recipientState: 'PENDING',
      });
    });

    describe('media attachments', () => {
      const uploadFixture = (overrides: Record<string, unknown> = {}) => ({
        id: 'upload-1',
        assetId: 'asset-1',
        publicId: 'public-1',
        secureUrl: 'https://cdn/upload-1',
        resourceType: 'IMAGE',
        width: 100,
        height: 100,
        duration: null,
        bytes: 1234,
        format: 'png',
        ...overrides,
      });

      beforeEach(() => {
        repository.findUserById.mockResolvedValue({
          id: 'user-2',
          status: 'ACTIVE',
        });
        blocksService.isBlocked.mockResolvedValue(false);
        repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
        repository.findDirectPair.mockResolvedValue(null);
      });

      it('resolves and attaches media to a new direct message', async () => {
        mediaService.resolveAttachableMedia.mockResolvedValue([
          uploadFixture(),
        ]);
        repository.createDirectConversationWithMessage.mockResolvedValue({
          conversation: { id: 'conversation-1' },
          message: { id: 'message-1' },
        });

        await service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: {
            clientMessageId: 'client-1',
            media: [{ mediaUploadId: 'upload-1', sortOrder: 0 }],
          },
        } as any);

        expect(mediaService.resolveAttachableMedia).toHaveBeenCalledWith({
          ids: ['upload-1'],
          userId: 'user-1',
          purpose: 'CHAT',
          maxImages: 4,
          maxVideos: 1,
          maxOpaqueBlobs: 10,
          entityLabel: 'chat message',
        });
        expect(
          repository.createDirectConversationWithMessage,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            media: [
              {
                mediaUploadId: 'upload-1',
                assetId: 'asset-1',
                publicId: 'public-1',
                url: 'https://cdn/upload-1',
                resourceType: 'IMAGE',
                sortOrder: 0,
                width: 100,
                height: 100,
                duration: null,
                bytes: 1234,
                format: 'png',
              },
            ],
          }),
        );
      });

      // Count/mix/missing-upload policy is enforced by, and tested directly
      // against, MediaService.resolveAttachableMedia. This just checks
      // createDirectMessage propagates a rejection instead of swallowing it.
      it('propagates a media resolution rejection and creates nothing', async () => {
        mediaService.resolveAttachableMedia.mockRejectedValue(
          new BadRequestException('A chat message supports at most 4 images'),
        );

        await expect(
          service.createDirectMessage('user-1', 'session-1', {
            recipientUserId: 'user-2',
            message: {
              clientMessageId: 'client-1',
              media: [{ mediaUploadId: 'upload-1' }],
            },
          } as any),
        ).rejects.toThrow(BadRequestException);

        expect(
          repository.createDirectConversationWithMessage,
        ).not.toHaveBeenCalled();
      });

      it('treats an explicit null media field the same as no attachments', async () => {
        repository.createDirectConversationWithMessage.mockResolvedValue({
          conversation: { id: 'conversation-1' },
          message: { id: 'message-1' },
        });

        await service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: {
            clientMessageId: 'client-1',
            media: null,
          },
        } as any);

        expect(mediaService.resolveAttachableMedia).not.toHaveBeenCalled();
        expect(
          repository.createDirectConversationWithMessage,
        ).toHaveBeenCalledWith(expect.objectContaining({ media: [] }));
      });
    });

    it('rejects a new conversation when the recipient accepts no messages', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
        messageRequestSetting: 'NO_ONE',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue(null);

      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(
        repository.createDirectConversationWithMessage,
      ).not.toHaveBeenCalled();
    });

    it('rejects a non-follower when the recipient only accepts messages from people they follow', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
        messageRequestSetting: 'FOLLOWERS',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue(null);
      followsService.isFollowing.mockResolvedValue({ following: false });

      await expect(
        service.createDirectMessage('user-1', 'session-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(followsService.isFollowing).toHaveBeenCalledWith(
        'user-2',
        'user-1',
      );
      expect(
        repository.createDirectConversationWithMessage,
      ).not.toHaveBeenCalled();
    });

    it('allows a message under FOLLOWERS when the recipient follows the sender', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
        messageRequestSetting: 'FOLLOWERS',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue(null);
      followsService.isFollowing.mockImplementation((followerId, followingId) =>
        Promise.resolve({
          following: followerId === 'user-2' && followingId === 'user-1',
        }),
      );
      repository.createDirectConversationWithMessage.mockResolvedValue({
        conversation: { id: 'conversation-1' },
        message: { id: 'message-1' },
      });

      await service.createDirectMessage('user-1', 'session-1', {
        recipientUserId: 'user-2',
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(
        repository.createDirectConversationWithMessage,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ recipientState: 'PENDING' }),
      );
    });

    it('resolves ACTIVE from two isFollowing calls when mutual', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
        messageRequestSetting: 'FOLLOWERS',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue(null);
      followsService.isFollowing.mockResolvedValue({ following: true });
      repository.createDirectConversationWithMessage.mockResolvedValue({
        conversation: { id: 'conversation-1' },
        message: { id: 'message-1' },
      });

      await service.createDirectMessage('user-1', 'session-1', {
        recipientUserId: 'user-2',
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(followsService.isFollowing).toHaveBeenCalledTimes(2);
      expect(followsService.isFollowing).toHaveBeenCalledWith(
        'user-1',
        'user-2',
      );
      expect(followsService.isFollowing).toHaveBeenCalledWith(
        'user-2',
        'user-1',
      );
      expect(
        repository.createDirectConversationWithMessage,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ recipientState: 'ACTIVE' }),
      );
    });

    it('starts ACTIVE and notifies when sender and recipient mutually follow', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue(null);
      followsService.isFollowing.mockResolvedValue({ following: true });
      repository.createDirectConversationWithMessage.mockResolvedValue({
        conversation: { id: 'conversation-1' },
        message: { id: 'message-1' },
      });

      const result = await service.createDirectMessage('user-1', 'session-1', {
        recipientUserId: 'user-2',
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(
        repository.createDirectConversationWithMessage,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientState: 'ACTIVE',
        }),
      );
      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldNotify: true,
        }),
      );
      expect(result).toEqual({
        conversationId: 'conversation-1',
        message: { id: 'message-1' },
        recipientState: 'ACTIVE',
      });
    });

    it('does not notify a mutual follower recipient who has blocked the sender', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue(null);
      followsService.isFollowing.mockResolvedValue({ following: true });
      blocksService.isBlocked.mockImplementation((blockerId, blockedId) =>
        Promise.resolve(blockerId === 'user-2' && blockedId === 'user-1'),
      );
      repository.createDirectConversationWithMessage.mockResolvedValue({
        conversation: { id: 'conversation-1' },
        message: { id: 'message-1' },
      });

      await service.createDirectMessage('user-1', 'session-1', {
        recipientUserId: 'user-2',
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(
        repository.createDirectConversationWithMessage,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientState: 'ACTIVE',
        }),
      );
      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldNotify: false,
        }),
      );
    });

    it('delegates to the existing conversation when a direct pair already exists', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      blocksService.isBlocked.mockResolvedValue(false);
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue({
        conversation: { id: 'conversation-1' },
      });
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.createDirectMessage('user-1', 'session-1', {
        recipientUserId: 'user-2',
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(
        repository.createDirectConversationWithMessage,
      ).not.toHaveBeenCalled();
      expect(repository.createMessage).toHaveBeenCalled();
    });

    describe('race conditions on the insert', () => {
      beforeEach(() => {
        repository.findUserById.mockResolvedValue({
          id: 'user-2',
          status: 'ACTIVE',
        });
        blocksService.isBlocked.mockResolvedValue(false);
      });

      it('recovers a clientMessageId conflict as a duplicate of the winning send', async () => {
        repository.findDirectPair.mockResolvedValueOnce(null);
        repository.findMessageBySenderClientMessageId.mockResolvedValueOnce(
          null,
        );
        repository.createDirectConversationWithMessage.mockRejectedValue(
          uniqueConstraintError('clientMessageId'),
        );
        repository.findDirectPair.mockResolvedValueOnce({
          conversation: { id: 'conversation-1' },
        });
        repository.findMessageBySenderClientMessageId.mockResolvedValueOnce({
          id: 'message-1',
          conversationId: 'conversation-1',
        });

        const result = await service.createDirectMessage(
          'user-1',
          'session-1',
          {
            recipientUserId: 'user-2',
            message: { clientMessageId: 'client-1' },
          } as any,
        );

        expect(result).toEqual({
          conversationId: 'conversation-1',
          message: { id: 'message-1', conversationId: 'conversation-1' },
          duplicate: true,
        });
      });

      it('recovers a direct-pair conflict by sending into the pair the other request just created', async () => {
        repository.findDirectPair.mockResolvedValueOnce(null);
        repository.findMessageBySenderClientMessageId.mockResolvedValueOnce(
          null,
        );
        repository.createDirectConversationWithMessage.mockRejectedValue(
          uniqueConstraintError('userIdA'),
        );
        repository.findDirectPair.mockResolvedValueOnce({
          conversation: { id: 'conversation-1' },
        });
        repository.findParticipant.mockResolvedValue({
          userId: 'user-1',
          state: 'ACTIVE',
        });
        repository.findConversationWithParticipants.mockResolvedValue(
          directConversation([
            { userId: 'user-1', state: 'ACTIVE' },
            { userId: 'user-2', state: 'ACTIVE' },
          ]),
        );
        repository.findMessageBySenderClientMessageId.mockResolvedValueOnce(
          null,
        );
        repository.createMessage.mockResolvedValue({ id: 'message-1' });

        const result = await service.createDirectMessage(
          'user-1',
          'session-1',
          {
            recipientUserId: 'user-2',
            message: { clientMessageId: 'client-1' },
          } as any,
        );

        expect(repository.createMessage).toHaveBeenCalled();
        expect(result).toEqual({
          conversationId: 'conversation-1',
          message: { id: 'message-1' },
          duplicate: false,
        });
      });

      it('rethrows a direct-pair conflict when the raced pair cannot be found', async () => {
        repository.findDirectPair.mockResolvedValueOnce(null);
        repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
        const conflict = uniqueConstraintError('userIdA');
        repository.createDirectConversationWithMessage.mockRejectedValue(
          conflict,
        );
        repository.findDirectPair.mockResolvedValueOnce(null);

        await expect(
          service.createDirectMessage('user-1', 'session-1', {
            recipientUserId: 'user-2',
            message: { clientMessageId: 'client-1' },
          } as any),
        ).rejects.toBe(conflict);
      });

      it('rethrows an unrelated error untouched', async () => {
        repository.findDirectPair.mockResolvedValueOnce(null);
        repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
        const unrelated = new Error('db connection lost');
        repository.createDirectConversationWithMessage.mockRejectedValue(
          unrelated,
        );

        await expect(
          service.createDirectMessage('user-1', 'session-1', {
            recipientUserId: 'user-2',
            message: { clientMessageId: 'client-1' },
          } as any),
        ).rejects.toBe(unrelated);
      });
    });
  });

  describe('sendMessage (existing conversation)', () => {
    beforeEach(() => {
      messageEncryption.preparePayload.mockResolvedValue({
        ciphertext: 'cipher',
        encryptionMeta: undefined,
      });
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      blocksService.isBlocked.mockResolvedValue(false);
    });

    it('rejects a send from a login never linked to a device, before touching the conversation', async () => {
      const notLinked = new Error('session not linked');
      chatDevicesService.assertSessionLinkedToActiveDevice.mockRejectedValue(
        notLinked,
      );

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toBe(notLinked);

      expect(
        chatDevicesService.assertSessionLinkedToActiveDevice,
      ).toHaveBeenCalledWith('user-1', 'session-1');
      expect(
        repository.findMessageBySenderClientMessageId,
      ).not.toHaveBeenCalled();
      expect(messageEncryption.preparePayload).not.toHaveBeenCalled();
    });

    it('rejects a send from a revoked device, before touching the conversation', async () => {
      const revoked = new Error('device revoked');
      chatDevicesService.assertSessionLinkedToActiveDevice.mockRejectedValue(
        revoked,
      );

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toBe(revoked);

      expect(
        repository.findMessageBySenderClientMessageId,
      ).not.toHaveBeenCalled();
    });

    it('returns duplicate immediately without checking the sender', async () => {
      repository.findMessageBySenderClientMessageId.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
      });

      const result = await service.sendMessage(
        'user-1',
        'session-1',
        'conversation-1',
        {
          message: { clientMessageId: 'client-1' },
        } as any,
      );

      expect(result.duplicate).toBe(true);
      expect(repository.findParticipant).not.toHaveBeenCalled();
    });

    it('rejects when the sender is not a participant', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([{ userId: 'user-2', state: 'ACTIVE' }]),
      );

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the sender participant is not active', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([{ userId: 'user-1', state: 'PENDING' }]),
      );

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('makes the sender wait while a group member is still being removed', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'OWNER', state: 'ACTIVE' },
          { userId: 'user-2', role: 'MEMBER', state: 'LEAVING' },
        ]),
      );

      const rejection = service.sendMessage(
        'user-1',
        'session-1',
        'conversation-1',
        {
          message: { clientMessageId: 'client-1' },
        } as any,
      );

      await expect(rejection).rejects.toThrow(MembershipChangePendingException);
      expect(repository.createMessage).not.toHaveBeenCalled();
    });

    it('does not tell an outsider a removal is pending - access is checked first', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-2', role: 'MEMBER', state: 'LEAVING' },
        ]),
      );

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the conversation is not found', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(null);

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the sender has blocked the direct recipient', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      blocksService.isBlocked.mockResolvedValue(true);

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.createMessage).not.toHaveBeenCalled();
    });

    it('rejects when the direct recipient blocked or declined the conversation', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'DECLINED' },
        ]),
      );

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an invalid reply target', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      repository.findSentMessageInConversation.mockResolvedValue(null);

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: {
            clientMessageId: 'client-1',
            replyToId: 'missing-message',
          },
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(repository.createMessage).not.toHaveBeenCalled();
    });

    it('sends successfully when the reply target exists in this conversation', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      repository.findSentMessageInConversation.mockResolvedValue({
        id: 'message-x',
        conversationId: 'conversation-1',
      });
      repository.createMessage.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
      });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1', replyToId: 'message-x' },
      } as any);

      expect(repository.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ replyToId: 'message-x' }),
      );
    });

    it('stores the message but skips notifying a direct recipient who blocked the sender', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      blocksService.isBlocked.mockImplementation((blockerId, blockedId) =>
        Promise.resolve(blockerId === 'user-2' && blockedId === 'user-1'),
      );
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(repository.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          participantUserIds: ['user-1', 'user-2'],
        }),
      );
      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledTimes(1);
      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: ['user-2'],
          shouldNotify: false,
        }),
      );
    });

    it('skips the block check when the direct conversation has no other participant left', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([{ userId: 'user-1', state: 'ACTIVE' }]),
      );
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(blocksService.isBlocked).not.toHaveBeenCalled();
      expect(repository.createMessage).toHaveBeenCalled();
    });

    it('does not let one muted group member suppress notification for others', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          {
            userId: 'user-1',
            role: 'OWNER',
            state: 'ACTIVE',
            notificationLevel: 'ALL',
          },
          {
            userId: 'user-2',
            role: 'MEMBER',
            state: 'ACTIVE',
            notificationLevel: 'NOTHING',
          },
          {
            userId: 'user-3',
            role: 'MEMBER',
            state: 'ACTIVE',
            notificationLevel: 'ALL',
          },
        ]),
      );
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: ['user-3'],
          shouldNotify: true,
        }),
      );
      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: ['user-2'],
          shouldNotify: false,
        }),
      );
    });

    it('does not notify a group member who has blocked the sender', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          {
            userId: 'user-1',
            role: 'OWNER',
            state: 'ACTIVE',
            notificationLevel: 'ALL',
          },
          {
            userId: 'user-2',
            role: 'MEMBER',
            state: 'ACTIVE',
            notificationLevel: 'ALL',
          },
          {
            userId: 'user-3',
            role: 'MEMBER',
            state: 'ACTIVE',
            notificationLevel: 'ALL',
          },
        ]),
      );
      blocksService.isBlocked.mockImplementation((blockerId, blockedId) =>
        Promise.resolve(blockerId === 'user-2' && blockedId === 'user-1'),
      );
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: ['user-3'],
          shouldNotify: true,
        }),
      );
      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: ['user-2'],
          shouldNotify: false,
        }),
      );
    });

    it('still suppresses notification while a timed mute has not expired', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE', notificationLevel: 'ALL' },
          {
            userId: 'user-2',
            state: 'ACTIVE',
            notificationLevel: 'NOTHING',
            mutedUntil: new Date(Date.now() + 60 * 60 * 1000),
          },
        ]),
      );
      blocksService.isBlocked.mockResolvedValue(false);
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: ['user-2'],
          shouldNotify: false,
        }),
      );
    });

    it('resumes notification once a timed mute has expired', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE', notificationLevel: 'ALL' },
          {
            userId: 'user-2',
            state: 'ACTIVE',
            notificationLevel: 'NOTHING',
            mutedUntil: new Date(Date.now() - 60 * 60 * 1000),
          },
        ]),
      );
      blocksService.isBlocked.mockResolvedValue(false);
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(chatDelivery.publishMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: ['user-2'],
          shouldNotify: true,
        }),
      );
    });

    it('does not unarchive a recipient just because a new message arrives', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ARCHIVED' },
        ]),
      );
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(repository.updateParticipantArchivedState).not.toHaveBeenCalled();
    });

    it('restores nobody when neither participant had deleted the conversation', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
        deletedAt: null,
      });
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(repository.restoreDeletedParticipants).not.toHaveBeenCalled();
    });

    it('restores the sender when they had deleted their own copy and send again', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE', deletedAt: new Date() },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(repository.restoreDeletedParticipants).toHaveBeenCalledWith(
        'conversation-1',
        ['user-1'],
      );
    });

    it('restores a recipient who had deleted the conversation when a new message arrives', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE', deletedAt: new Date() },
        ]),
      );
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(repository.restoreDeletedParticipants).toHaveBeenCalledWith(
        'conversation-1',
        ['user-2'],
      );
      expect(repository.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          participantUserIds: ['user-1', 'user-2'],
        }),
      );
    });

    it('resolves and attaches media when sending into an existing conversation', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      mediaService.resolveAttachableMedia.mockResolvedValue([
        {
          id: 'upload-1',
          assetId: 'asset-1',
          publicId: 'public-1',
          secureUrl: 'https://cdn/upload-1',
          resourceType: 'IMAGE',
          width: 100,
          height: 100,
          duration: null,
          bytes: 1234,
          format: 'png',
        },
      ]);
      repository.createMessage.mockResolvedValue({ id: 'message-1' });

      await service.sendMessage('user-1', 'session-1', 'conversation-1', {
        message: {
          clientMessageId: 'client-1',
          media: [{ mediaUploadId: 'upload-1', sortOrder: 0 }],
        },
      } as any);

      expect(mediaService.resolveAttachableMedia).toHaveBeenCalledWith({
        ids: ['upload-1'],
        userId: 'user-1',
        purpose: 'CHAT',
        maxImages: 4,
        maxVideos: 1,
        maxOpaqueBlobs: 10,
        entityLabel: 'chat message',
      });
      expect(repository.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          media: [
            {
              mediaUploadId: 'upload-1',
              assetId: 'asset-1',
              publicId: 'public-1',
              url: 'https://cdn/upload-1',
              resourceType: 'IMAGE',
              sortOrder: 0,
              width: 100,
              height: 100,
              duration: null,
              bytes: 1234,
              format: 'png',
            },
          ],
        }),
      );
    });

    it('does not resurrect a deleted participant when media validation rejects the send', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE', deletedAt: new Date() },
        ]),
      );
      mediaService.resolveAttachableMedia.mockRejectedValue(
        new BadRequestException('A chat message supports at most 4 images'),
      );

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: {
            clientMessageId: 'client-1',
            media: [{ mediaUploadId: 'upload-1' }],
          },
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(repository.restoreDeletedParticipants).not.toHaveBeenCalled();
      expect(repository.createMessage).not.toHaveBeenCalled();
    });

    it('rejects a duplicate clientMessageId that belongs to a different conversation', async () => {
      repository.findMessageBySenderClientMessageId.mockResolvedValue({
        id: 'message-1',
        conversationId: 'a-different-conversation',
      });

      await expect(
        service.sendMessage('user-1', 'session-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    describe('race conditions on the insert', () => {
      beforeEach(() => {
        repository.findConversationWithParticipants.mockResolvedValue(
          directConversation([
            { userId: 'user-1', state: 'ACTIVE' },
            { userId: 'user-2', state: 'ACTIVE' },
          ]),
        );
      });

      it('recovers a clientMessageId conflict as a duplicate of the winning send', async () => {
        repository.createMessage.mockRejectedValue(
          uniqueConstraintError('clientMessageId'),
        );
        repository.findMessageBySenderClientMessageId.mockResolvedValueOnce(
          null,
        );
        repository.findMessageBySenderClientMessageId.mockResolvedValueOnce({
          id: 'message-1',
          conversationId: 'conversation-1',
        });

        const result = await service.sendMessage(
          'user-1',
          'session-1',
          'conversation-1',
          {
            message: { clientMessageId: 'client-1' },
          } as any,
        );

        expect(result).toEqual({
          conversationId: 'conversation-1',
          message: { id: 'message-1', conversationId: 'conversation-1' },
          duplicate: true,
        });
      });

      it('recovers a clientMessageId conflict when Prisma reports the target as a string, not an array', async () => {
        repository.createMessage.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: 'clientMessageId' },
          }),
        );
        repository.findMessageBySenderClientMessageId.mockResolvedValueOnce(
          null,
        );
        repository.findMessageBySenderClientMessageId.mockResolvedValueOnce({
          id: 'message-1',
          conversationId: 'conversation-1',
        });

        const result = await service.sendMessage(
          'user-1',
          'session-1',
          'conversation-1',
          {
            message: { clientMessageId: 'client-1' },
          } as any,
        );

        expect(result.duplicate).toBe(true);
      });

      it('rejects when the conflicting row cannot be found on recovery', async () => {
        repository.createMessage.mockRejectedValue(
          uniqueConstraintError('clientMessageId'),
        );
        repository.findMessageBySenderClientMessageId.mockResolvedValue(null);

        await expect(
          service.sendMessage('user-1', 'session-1', 'conversation-1', {
            message: { clientMessageId: 'client-1' },
          } as any),
        ).rejects.toThrow(ConflictException);
      });

      it('rethrows an unrelated error untouched', async () => {
        const unrelated = new Error('db connection lost');
        repository.createMessage.mockRejectedValue(unrelated);

        await expect(
          service.sendMessage('user-1', 'session-1', 'conversation-1', {
            message: { clientMessageId: 'client-1' },
          } as any),
        ).rejects.toBe(unrelated);
      });
    });
  });
});
