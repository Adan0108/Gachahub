import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
jest.mock('./chat.repository', () => ({
  ChatRepository: class {},
}));
jest.mock('./membership/chat-membership.repository', () => ({
  ChatMembershipRepository: class {},
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
import { ChatInboxService } from './chat-inbox.service';

describe('ChatInboxService', () => {
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

  const membershipService = {
    acceptInvite: jest.fn(),
    declineInvite: jest.fn(),
  };

  const historyFetchRateLimiter = {
    assertNotRateLimited: jest.fn(),
  };

  let chatAccessService: ChatAccessService;
  let service: ChatInboxService;

  beforeEach(() => {
    jest.clearAllMocks();
    chatAccessService = new ChatAccessService(
      repository as any,
      followsService as any,
      blocksService as any,
      gameModeratorsService as any,
    );
    service = new ChatInboxService(
      repository as any,
      chatAccessService,
      blocksService as any,
      membershipService as any,
      historyFetchRateLimiter as any,
    );
    blocksService.getBlockedIdsAmong.mockResolvedValue(new Set());
    blocksService.isBlocked.mockResolvedValue(false);
    followsService.isFollowing.mockResolvedValue({ following: false });
    repository.countUnreadMessagesForConversations.mockResolvedValue([]);
  });

  describe('conversation participant toggles (permission)', () => {
    const readableParticipantGatedMethods: Array<{
      name: string;
      call: (userId: string, conversationId: string) => Promise<unknown>;
    }> = [
      {
        name: 'blockConversation',
        call: (u, c) => service.blockConversation(u, c),
      },
      {
        name: 'setNotificationLevel',
        call: (u, c) => service.setNotificationLevel(u, c, 'NOTHING'),
      },
      {
        name: 'archiveConversation',
        call: (u, c) => service.archiveConversation(u, c),
      },
      {
        name: 'unarchiveConversation',
        call: (u, c) => service.unarchiveConversation(u, c),
      },
      {
        name: 'pinConversation',
        call: (u, c) => service.pinConversation(u, c),
      },
      {
        name: 'unpinConversation',
        call: (u, c) => service.unpinConversation(u, c),
      },
    ];

    it.each(readableParticipantGatedMethods)(
      '$name rejects when the conversation is not found',
      async ({ call }) => {
        repository.findParticipant.mockResolvedValue(null);

        await expect(call('user-1', 'conversation-1')).rejects.toThrow(
          NotFoundException,
        );
      },
    );

    it.each(readableParticipantGatedMethods)(
      '$name rejects an unreadable participant state',
      async ({ call }) => {
        repository.findParticipant.mockResolvedValue({
          userId: 'user-1',
          state: 'BLOCKED',
        });

        await expect(call('user-1', 'conversation-1')).rejects.toThrow(
          ForbiddenException,
        );
      },
    );
  });

  describe('conversation participant toggles (behavior)', () => {
    beforeEach(() => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
    });

    it('blockConversation sets the participant state to BLOCKED', async () => {
      await service.blockConversation('user-1', 'conversation-1');

      expect(repository.updateParticipantState).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        'BLOCKED',
      );
    });

    it('setNotificationLevel sets NOTHING with a mute expiry', async () => {
      await service.setNotificationLevel(
        'user-1',
        'conversation-1',
        'NOTHING',
        '2026-08-17T20:00:00.000Z',
      );

      expect(
        repository.updateParticipantNotificationLevel,
      ).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        'NOTHING',
        new Date('2026-08-17T20:00:00.000Z'),
      );
    });

    it('setNotificationLevel sets ALL and clears any mute expiry', async () => {
      await service.setNotificationLevel('user-1', 'conversation-1', 'ALL');

      expect(
        repository.updateParticipantNotificationLevel,
      ).toHaveBeenCalledWith('conversation-1', 'user-1', 'ALL', null);
    });

    it('archiveConversation sets archived to true', async () => {
      await service.archiveConversation('user-1', 'conversation-1');

      expect(repository.updateParticipantArchivedState).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        true,
      );
    });

    it('archiveConversation rejects a non-active participant', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'PENDING',
      });

      await expect(
        service.archiveConversation('user-1', 'conversation-1'),
      ).rejects.toThrow(BadRequestException);

      expect(repository.updateParticipantArchivedState).not.toHaveBeenCalled();
    });

    it('unarchiveConversation rejects a non-archived participant', async () => {
      await expect(
        service.unarchiveConversation('user-1', 'conversation-1'),
      ).rejects.toThrow(BadRequestException);

      expect(repository.updateParticipantArchivedState).not.toHaveBeenCalled();
    });

    it('unarchiveConversation sets archived to false', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ARCHIVED',
      });

      await service.unarchiveConversation('user-1', 'conversation-1');

      expect(repository.updateParticipantArchivedState).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        false,
      );
    });

    it('pinConversation sets pinnedAt to a timestamp', async () => {
      await service.pinConversation('user-1', 'conversation-1');

      expect(repository.updateParticipantPinnedAt).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        expect.any(Date),
      );
    });

    it('unpinConversation clears pinnedAt', async () => {
      await service.unpinConversation('user-1', 'conversation-1');

      expect(repository.updateParticipantPinnedAt).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        null,
      );
    });
  });

  describe('blockUser', () => {
    it('rejects blocking yourself', async () => {
      await expect(service.blockUser('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when the target user does not exist', async () => {
      repository.findUserById.mockResolvedValue(null);

      await expect(service.blockUser('user-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects when the target user is not active', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'SUSPENDED',
      });

      await expect(service.blockUser('user-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates the block on success', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      blocksService.block.mockResolvedValue({
        blockerId: 'user-1',
        blockedId: 'user-2',
      });

      await service.blockUser('user-1', 'user-2');

      expect(blocksService.block).toHaveBeenCalledWith('user-1', 'user-2');
    });
  });

  describe('unblockUser', () => {
    it('rejects unblocking yourself', async () => {
      await expect(service.unblockUser('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('removes the block and returns the count on success', async () => {
      blocksService.unblock.mockResolvedValue(1);

      const result = await service.unblockUser('user-1', 'user-2');

      expect(blocksService.unblock).toHaveBeenCalledWith('user-1', 'user-2');
      expect(result).toEqual({ unblockedCount: 1 });
    });
  });

  describe('acceptRequest / declineRequest', () => {
    const requestMethods: Array<{
      name: string;
      call: (userId: string, conversationId: string) => Promise<unknown>;
      membershipCall: jest.Mock;
    }> = [
      {
        name: 'acceptRequest',
        call: (u, c) => service.acceptRequest(u, c),
        membershipCall: membershipService.acceptInvite,
      },
      {
        name: 'declineRequest',
        call: (u, c) => service.declineRequest(u, c),
        membershipCall: membershipService.declineInvite,
      },
    ];

    it.each(requestMethods)(
      '$name rejects when the conversation is not found',
      async ({ call, membershipCall }) => {
        repository.findParticipant.mockResolvedValue(null);

        await expect(call('user-1', 'conversation-1')).rejects.toThrow(
          NotFoundException,
        );
        expect(membershipCall).not.toHaveBeenCalled();
      },
    );

    it.each(requestMethods)(
      '$name treats a conversation the user deleted as not found',
      async ({ call, membershipCall }) => {
        repository.findParticipant.mockResolvedValue({
          userId: 'user-1',
          state: 'PENDING',
          deletedAt: new Date(),
        });

        await expect(call('user-1', 'conversation-1')).rejects.toThrow(
          NotFoundException,
        );
        expect(membershipCall).not.toHaveBeenCalled();
      },
    );

    it.each(requestMethods)(
      '$name hands the change to the membership service and returns the updated participant',
      async ({ call, membershipCall }) => {
        const updated = { userId: 'user-1', state: 'JOINING' };
        repository.findParticipant
          .mockResolvedValueOnce({ userId: 'user-1', state: 'PENDING' })
          .mockResolvedValueOnce(updated);
        membershipCall.mockResolvedValue(undefined);

        await expect(call('user-1', 'conversation-1')).resolves.toBe(updated);

        expect(membershipCall).toHaveBeenCalledWith('conversation-1', 'user-1');
      },
    );

    it.each(requestMethods)(
      '$name surfaces the membership service rejecting a conversation that is not pending',
      async ({ call, membershipCall }) => {
        repository.findParticipant.mockResolvedValue({
          userId: 'user-1',
          state: 'ACTIVE',
        });
        membershipCall.mockRejectedValue(
          new BadRequestException('Conversation is not pending'),
        );

        await expect(call('user-1', 'conversation-1')).rejects.toThrow(
          BadRequestException,
        );
      },
    );
  });

  describe('markDelivered', () => {
    it('marks the given message ids delivered and returns the count', async () => {
      repository.markMessagesDelivered.mockResolvedValue({ count: 3 });

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
  });

  describe('markRead', () => {
    it('rejects when the conversation is not found', async () => {
      repository.findParticipant.mockResolvedValue(null);

      await expect(
        service.markRead('user-1', 'conversation-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an unreadable participant state', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'BLOCKED',
      });

      await expect(
        service.markRead('user-1', 'conversation-1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('marks the conversation read and returns the count', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.markConversationRead.mockResolvedValue({ count: 5 });

      const result = await service.markRead('user-1', 'conversation-1', {
        lastReadMessageId: 'message-5',
      });

      expect(repository.markConversationRead).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        userId: 'user-1',
        lastReadMessageId: 'message-5',
      });
      expect(result).toEqual({ readCount: 5 });
    });
  });

  describe('listConversations', () => {
    const buildConversation = (
      id: string,
      updatedAt: Date,
      currentUserPinnedAt: Date | null,
    ) => ({
      id,
      type: 'DIRECT',
      status: 'ACTIVE',
      updatedAt,
      createdAt: updatedAt,
      lastMessageId: null,
      participants: [
        {
          userId: 'user-1',
          role: 'MEMBER',
          state: 'ACTIVE',
          pinnedAt: currentUserPinnedAt,
          mutedAt: null,
          user: { id: 'user-1' },
        },
        {
          userId: 'user-2',
          role: 'MEMBER',
          state: 'ACTIVE',
          pinnedAt: null,
          mutedAt: null,
          user: { id: 'user-2' },
        },
      ],
      messages: [],
    });

    it('sorts pinned conversations first, then by most recently updated', async () => {
      repository.findInboxConversations.mockResolvedValue([
        buildConversation('conv-old-unpinned', new Date('2024-01-01'), null),
        buildConversation(
          'conv-new-pinned',
          new Date('2024-01-03'),
          new Date('2024-01-02'),
        ),
        buildConversation('conv-new-unpinned', new Date('2024-01-04'), null),
        buildConversation(
          'conv-old-pinned',
          new Date('2024-01-02'),
          new Date('2024-01-01'),
        ),
      ]);

      const result = await service.listConversations('user-1');

      expect(result.map((conversation) => conversation.id)).toEqual([
        'conv-new-pinned',
        'conv-old-pinned',
        'conv-new-unpinned',
        'conv-old-unpinned',
      ]);
    });

    it('fetches only ACTIVE inbox conversations', async () => {
      repository.findInboxConversations.mockResolvedValue([]);

      await service.listConversations('user-1');

      expect(repository.findInboxConversations).toHaveBeenCalledWith(
        'user-1',
        'ACTIVE',
      );
    });

    it("masks another participant's BLOCKED state as ACTIVE so it isn't leaked to the viewer", async () => {
      repository.findInboxConversations.mockResolvedValue([
        {
          id: 'conversation-1',
          type: 'DIRECT',
          status: 'ACTIVE',
          updatedAt: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          lastMessageId: null,
          participants: [
            {
              userId: 'user-1',
              role: 'MEMBER',
              state: 'ACTIVE',
              pinnedAt: null,
              mutedAt: null,
              user: { id: 'user-1' },
            },
            {
              userId: 'user-2',
              role: 'MEMBER',
              state: 'BLOCKED',
              pinnedAt: null,
              mutedAt: null,
              user: { id: 'user-2' },
            },
          ],
          messages: [],
        },
      ]);

      const [result] = await service.listConversations('user-1');

      const otherParticipant = result.participants.find(
        (participant) => participant.userId === 'user-2',
      );
      expect(otherParticipant?.state).toBe('ACTIVE');
    });

    // regression: title/photoUrl come back from Prisma on every conversation
    // (include doesn't restrict scalars) but were being dropped when shaping
    // the summary, leaving the frontend with no name to show for a group.
    it('includes a group conversation title and photo in the summary', async () => {
      repository.findInboxConversations.mockResolvedValue([
        {
          ...buildConversation('group-1', new Date('2024-01-01'), null),
          type: 'GROUP',
          title: 'Team Build Chat',
          photoUrl: 'https://cdn.gachahub.com/chat/groups/team-build.png',
        },
      ]);

      const [result] = await service.listConversations('user-1');

      expect(result.title).toBe('Team Build Chat');
      expect(result.photoUrl).toBe(
        'https://cdn.gachahub.com/chat/groups/team-build.png',
      );
    });
  });

  describe('listMessageRequests', () => {
    const buildPendingConversation = () => ({
      id: 'conversation-1',
      type: 'DIRECT',
      status: 'ACTIVE',
      updatedAt: new Date('2024-01-01'),
      createdAt: new Date('2024-01-01'),
      participants: [
        {
          userId: 'user-1',
          role: 'MEMBER',
          state: 'PENDING',
          pinnedAt: null,
          notificationLevel: 'ALL',
          mutedUntil: null,
          user: { id: 'user-1' },
        },
        {
          userId: 'user-2',
          role: 'MEMBER',
          state: 'ACTIVE',
          pinnedAt: null,
          notificationLevel: 'ALL',
          mutedUntil: null,
          user: { id: 'user-2' },
        },
      ],
      messages: [],
    });

    it('fetches PENDING inbox conversations', async () => {
      repository.findInboxConversations.mockResolvedValue([]);

      await service.listMessageRequests('user-1');

      expect(repository.findInboxConversations).toHaveBeenCalledWith(
        'user-1',
        'PENDING',
      );
    });

    it('returns a summary for each pending request', async () => {
      repository.findInboxConversations.mockResolvedValue([
        buildPendingConversation(),
      ]);
      repository.countUnreadMessagesForConversations.mockResolvedValue([
        { conversationId: 'conversation-1', _count: { _all: 2 } },
      ]);

      const result = await service.listMessageRequests('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('conversation-1');
      expect(result[0].participantState).toBe('PENDING');
      expect(result[0].unreadCount).toBe(2);
    });
  });

  describe('listArchivedConversations', () => {
    const buildArchivedConversation = () => ({
      id: 'conversation-1',
      type: 'DIRECT',
      status: 'ACTIVE',
      updatedAt: new Date('2024-01-01'),
      createdAt: new Date('2024-01-01'),
      participants: [
        {
          userId: 'user-1',
          role: 'MEMBER',
          state: 'ARCHIVED',
          pinnedAt: null,
          notificationLevel: 'ALL',
          mutedUntil: null,
          user: { id: 'user-1' },
        },
        {
          userId: 'user-2',
          role: 'MEMBER',
          state: 'ACTIVE',
          pinnedAt: null,
          notificationLevel: 'ALL',
          mutedUntil: null,
          user: { id: 'user-2' },
        },
      ],
      messages: [],
    });

    it('fetches ARCHIVED inbox conversations', async () => {
      repository.findInboxConversations.mockResolvedValue([]);

      await service.listArchivedConversations('user-1');

      expect(repository.findInboxConversations).toHaveBeenCalledWith(
        'user-1',
        'ARCHIVED',
      );
    });

    it('returns a summary for each archived conversation', async () => {
      repository.findInboxConversations.mockResolvedValue([
        buildArchivedConversation(),
      ]);

      const result = await service.listArchivedConversations('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].participantState).toBe('ARCHIVED');
    });
  });

  describe('getUnreadSummary', () => {
    it('combines unread message and conversation counts', async () => {
      repository.countUnreadMessagesForUser.mockResolvedValue(5);
      repository.countUnreadConversationsForUser.mockResolvedValue(2);

      const result = await service.getUnreadSummary('user-1');

      expect(repository.countUnreadMessagesForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(repository.countUnreadConversationsForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result).toEqual({
        unreadMessageCount: 5,
        unreadConversationCount: 2,
      });
    });
  });

  describe('findMessages', () => {
    it('rejects when the conversation is not found', async () => {
      repository.findParticipant.mockResolvedValue(null);

      await expect(
        service.findMessages('user-1', 'conversation-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an unreadable participant state', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'BLOCKED',
      });

      await expect(
        service.findMessages('user-1', 'conversation-1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a pending group invitee to read message history before they accept', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'PENDING',
      });
      repository.findMessages.mockResolvedValue([]);

      await expect(
        service.findMessages('user-1', 'conversation-1', {} as any),
      ).resolves.toBeDefined();
    });

    it('allows a pending direct message request to preview history', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'PENDING',
      });
      repository.findMessages.mockResolvedValue([]);

      await expect(
        service.findMessages('user-1', 'conversation-1', {} as any),
      ).resolves.toBeDefined();
    });

    it("passes the query params through as given, limit default is the DTO's job", async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findSentMessageInConversation.mockResolvedValue({
        id: 'message-5',
      });
      repository.findMessages.mockResolvedValue([]);

      await service.findMessages('user-1', 'conversation-1', {
        beforeMessageId: 'message-5',
        limit: 30,
      });

      expect(repository.findMessages).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        beforeMessageId: 'message-5',
        limit: 30,
      });
    });

    it('does not rate limit the initial page, only paginated fetches', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findMessages.mockResolvedValue([]);

      await service.findMessages('user-1', 'conversation-1', {} as any);

      expect(
        historyFetchRateLimiter.assertNotRateLimited,
      ).not.toHaveBeenCalled();
    });

    it('rate limits a paginated fetch before touching the cursor or the database', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      historyFetchRateLimiter.assertNotRateLimited.mockImplementationOnce(
        () => {
          throw new Error('rate limited');
        },
      );

      await expect(
        service.findMessages('user-1', 'conversation-1', {
          beforeMessageId: 'message-5',
          limit: 30,
        }),
      ).rejects.toThrow('rate limited');

      expect(historyFetchRateLimiter.assertNotRateLimited).toHaveBeenCalledWith(
        'user-1',
        'conversation-1',
      );
      expect(repository.findSentMessageInConversation).not.toHaveBeenCalled();
      expect(repository.findMessages).not.toHaveBeenCalled();
    });

    it('rejects a beforeMessageId that does not belong to this conversation', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findSentMessageInConversation.mockResolvedValue(null);

      await expect(
        service.findMessages('user-1', 'conversation-1', {
          beforeMessageId: 'message-from-another-conversation',
          limit: 30,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.findMessages).not.toHaveBeenCalled();
    });

    it('honors an explicit limit instead of the default', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findMessages.mockResolvedValue([]);

      await service.findMessages('user-1', 'conversation-1', {
        limit: 10,
      });

      expect(repository.findMessages).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });

    it('reverses the newest-first DB order into chronological order', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findMessages.mockResolvedValue([
        { id: 'message-3' },
        { id: 'message-2' },
        { id: 'message-1' },
      ]);

      const result = await service.findMessages('user-1', 'conversation-1', {
        limit: 30,
      });

      expect(result.items.map((message) => message.id)).toEqual([
        'message-1',
        'message-2',
        'message-3',
      ]);
    });

    it('uses the oldest message in the page as the next cursor', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findMessages.mockResolvedValue([
        { id: 'message-3' },
        { id: 'message-2' },
        { id: 'message-1' },
      ]);

      const result = await service.findMessages('user-1', 'conversation-1', {
        limit: 30,
      });

      expect(result.meta.nextBeforeMessageId).toBe('message-1');
    });

    it('returns a null cursor and empty items when there are no messages', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findMessages.mockResolvedValue([]);

      const result = await service.findMessages('user-1', 'conversation-1', {
        limit: 30,
      });

      expect(result.meta.nextBeforeMessageId).toBeNull();
      expect(result.items).toEqual([]);
    });

    it('delivers messages from a blocked sender instead of filtering them out', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findMessages.mockResolvedValue([
        { id: 'message-1', senderId: 'user-2' },
      ]);
      blocksService.getBlockedIdsAmong.mockResolvedValue(new Set(['user-2']));

      const result = await service.findMessages('user-1', 'conversation-1', {
        limit: 30,
      });

      expect(blocksService.getBlockedIdsAmong).toHaveBeenCalledWith('user-1', [
        'user-2',
      ]);
      expect(result.items.map((message) => message.id)).toEqual(['message-1']);
      expect(result.meta.blockedSenderUserIds).toEqual(['user-2']);
    });
  });

  describe('deleteConversation', () => {
    it('rejects when the caller is not a participant', async () => {
      repository.findParticipant.mockResolvedValue(null);

      await expect(
        service.deleteConversation('user-1', 'conversation-1'),
      ).rejects.toThrow(NotFoundException);

      expect(
        repository.softDeleteConversationForParticipant,
      ).not.toHaveBeenCalled();
    });

    it.each(['ACTIVE', 'PENDING', 'ARCHIVED', 'BLOCKED', 'DECLINED'])(
      'deletes the conversation for a %s participant',
      async (state) => {
        repository.findParticipant.mockResolvedValue({
          userId: 'user-1',
          state,
        });
        repository.softDeleteConversationForParticipant.mockResolvedValue({
          userId: 'user-1',
          deletedAt: new Date(),
        });

        const result = await service.deleteConversation(
          'user-1',
          'conversation-1',
        );

        expect(
          repository.softDeleteConversationForParticipant,
        ).toHaveBeenCalledWith('conversation-1', 'user-1');
        expect(result).toEqual({
          message: 'Conversation deleted successfully',
        });
      },
    );
  });
});
