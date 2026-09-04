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
// real Prisma namespace, not a stub - chat.service.ts checks `instanceof`
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
import { ChatService } from './chat.service';

describe('ChatService', () => {
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

  const messageEncryption = {
    preparePayload: jest.fn(),
  };

  const chatMessageRateLimiter = {
    assertNotRateLimited: jest.fn(),
  };

  const chatDelivery = {
    publishMessageCreated: jest.fn(),
    publishMessageEdited: jest.fn(),
    publishMessageDeleted: jest.fn(),
    publishReactionAdded: jest.fn(),
    publishReactionRemoved: jest.fn(),
  };

  let service: ChatService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatService(
      repository as any,
      followsService as any,
      blocksService as any,
      gamesService as any,
      gameModeratorsService as any,
      chatMessageRateLimiter as any,
      messageEncryption,
      chatDelivery,
    );
    blocksService.getBlockedIdsAmong.mockResolvedValue(new Set());
    blocksService.isBlocked.mockResolvedValue(false);
    followsService.isFollowing.mockResolvedValue({ following: false });
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

  describe('createGroupChat', () => {
    it('rejects when no members remain besides the creator', async () => {
      await expect(
        service.createGroupChat('user-1', {
          title: 'Team Chat',
          memberUserIds: ['user-1'],
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(repository.findActiveUsersByIds).not.toHaveBeenCalled();
    });

    it('rejects when a member is invalid or inactive', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([{ id: 'user-2' }]);

      await expect(
        service.createGroupChat('user-1', {
          title: 'Team Chat',
          memberUserIds: ['user-2', 'user-3'],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the group with a deduped, creator-excluded member list', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([
        { id: 'user-2' },
        { id: 'user-3' },
      ]);
      repository.createGroupConversation.mockResolvedValue({
        id: 'conversation-1',
      });

      await service.createGroupChat('user-1', {
        title: 'Team Chat',
        photoUrl: 'https://cdn.example.com/photo.png',
        memberUserIds: ['user-2', 'user-3', 'user-2', 'user-1'],
      });

      expect(repository.findActiveUsersByIds).toHaveBeenCalledWith([
        'user-2',
        'user-3',
      ]);
      expect(repository.createGroupConversation).toHaveBeenCalledWith({
        creatorId: 'user-1',
        title: 'Team Chat',
        photoUrl: 'https://cdn.example.com/photo.png',
        members: [
          { userId: 'user-2', state: 'PENDING' },
          { userId: 'user-3', state: 'PENDING' },
        ],
      });
    });

    it('resolves mutual followers to ACTIVE and others to PENDING', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([
        { id: 'user-2' },
        { id: 'user-3' },
      ]);
      followsService.isFollowing.mockImplementation((followerId, followingId) =>
        Promise.resolve({
          following:
            (followerId === 'user-1' && followingId === 'user-2') ||
            (followerId === 'user-2' && followingId === 'user-1'),
        }),
      );
      repository.createGroupConversation.mockResolvedValue({
        id: 'conversation-1',
      });

      await service.createGroupChat('user-1', {
        title: 'Team Chat',
        memberUserIds: ['user-2', 'user-3'],
      });

      expect(repository.createGroupConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          members: [
            { userId: 'user-2', state: 'ACTIVE' },
            { userId: 'user-3', state: 'PENDING' },
          ],
        }),
      );
    });

    it('rejects when a member is not accepting new messages (NO_ONE)', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([
        { id: 'user-2', messageRequestSetting: 'NO_ONE' },
      ]);

      await expect(
        service.createGroupChat('user-1', {
          title: 'Team Chat',
          memberUserIds: ['user-2'],
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.createGroupConversation).not.toHaveBeenCalled();
    });

    it('rejects a FOLLOWERS-only member who does not follow the adder back', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([
        { id: 'user-2', messageRequestSetting: 'FOLLOWERS' },
      ]);
      followsService.isFollowing.mockResolvedValue({ following: false });

      await expect(
        service.createGroupChat('user-1', {
          title: 'Team Chat',
          memberUserIds: ['user-2'],
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.createGroupConversation).not.toHaveBeenCalled();
    });

    it('allows a FOLLOWERS-only member who follows the adder, joining as PENDING', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([
        { id: 'user-2', messageRequestSetting: 'FOLLOWERS' },
      ]);
      followsService.isFollowing.mockImplementation((followerId, followingId) =>
        Promise.resolve({
          following: followerId === 'user-2' && followingId === 'user-1',
        }),
      );
      repository.createGroupConversation.mockResolvedValue({
        id: 'conversation-1',
      });

      await service.createGroupChat('user-1', {
        title: 'Team Chat',
        memberUserIds: ['user-2'],
      });

      expect(repository.createGroupConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          members: [{ userId: 'user-2', state: 'PENDING' }],
        }),
      );
    });
  });

  describe('group management permission (updateGroupChat)', () => {
    it('throws NotFoundException when the conversation is missing', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(null);

      await expect(
        service.updateGroupChat('user-1', 'conversation-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the conversation is not a group', async () => {
      repository.findConversationWithParticipants.mockResolvedValue({
        id: 'conversation-1',
        type: 'DIRECT',
        participants: [],
      });

      await expect(
        service.updateGroupChat('user-1', 'conversation-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the caller is not an active participant', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-2', role: 'OWNER', state: 'ACTIVE' },
        ]),
      );

      await expect(
        service.updateGroupChat('user-1', 'conversation-1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the caller is a plain member', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'MEMBER', state: 'ACTIVE' },
        ]),
      );

      await expect(
        service.updateGroupChat('user-1', 'conversation-1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each(['OWNER', 'ADMIN'])(
      'allows an active %s participant to update group details',
      async (role) => {
        repository.findConversationWithParticipants.mockResolvedValue(
          groupConversation([{ userId: 'user-1', role, state: 'ACTIVE' }]),
        );
        repository.updateGroupConversation.mockResolvedValue({
          id: 'conversation-1',
        });

        await service.updateGroupChat('user-1', 'conversation-1', {
          title: 'New Title',
        });

        expect(repository.updateGroupConversation).toHaveBeenCalledWith({
          conversationId: 'conversation-1',
          title: 'New Title',
          photoUrl: undefined,
        });
      },
    );
  });

  describe('addGroupMembers', () => {
    beforeEach(() => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'OWNER', state: 'ACTIVE' },
        ]),
      );
    });

    it('rejects a non-manager caller', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'MEMBER', state: 'ACTIVE' },
        ]),
      );

      await expect(
        service.addGroupMembers('user-1', 'conversation-1', {
          userIds: ['user-2'],
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when no members remain after excluding the caller', async () => {
      await expect(
        service.addGroupMembers('user-1', 'conversation-1', {
          userIds: ['user-1'],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when a member is invalid or inactive', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([]);

      await expect(
        service.addGroupMembers('user-1', 'conversation-1', {
          userIds: ['user-2'],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('adds a deduped member list on success', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([
        { id: 'user-2' },
        { id: 'user-3' },
      ]);
      repository.addGroupMembers.mockResolvedValue({ count: 2 });

      await service.addGroupMembers('user-1', 'conversation-1', {
        userIds: ['user-2', 'user-3', 'user-2'],
      });

      expect(repository.addGroupMembers).toHaveBeenCalledWith(
        'conversation-1',
        [
          { userId: 'user-2', state: 'PENDING' },
          { userId: 'user-3', state: 'PENDING' },
        ],
      );
    });

    it('resolves mutual followers to ACTIVE and others to PENDING', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([
        { id: 'user-2' },
        { id: 'user-3' },
      ]);
      followsService.isFollowing.mockImplementation((followerId, followingId) =>
        Promise.resolve({
          following:
            (followerId === 'user-1' && followingId === 'user-3') ||
            (followerId === 'user-3' && followingId === 'user-1'),
        }),
      );
      repository.addGroupMembers.mockResolvedValue({ count: 2 });

      await service.addGroupMembers('user-1', 'conversation-1', {
        userIds: ['user-2', 'user-3'],
      });

      expect(repository.addGroupMembers).toHaveBeenCalledWith(
        'conversation-1',
        [
          { userId: 'user-2', state: 'PENDING' },
          { userId: 'user-3', state: 'ACTIVE' },
        ],
      );
    });

    it('rejects adding a member who is not accepting new messages (NO_ONE)', async () => {
      repository.findActiveUsersByIds.mockResolvedValue([
        { id: 'user-2', messageRequestSetting: 'NO_ONE' },
      ]);

      await expect(
        service.addGroupMembers('user-1', 'conversation-1', {
          userIds: ['user-2'],
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.addGroupMembers).not.toHaveBeenCalled();
    });
  });

  describe('removeGroupMembers', () => {
    beforeEach(() => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'OWNER', state: 'ACTIVE' },
        ]),
      );
    });

    it('rejects a non-manager caller', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'MEMBER', state: 'ACTIVE' },
        ]),
      );

      await expect(
        service.removeGroupMembers('user-1', 'conversation-1', {
          userIds: ['user-2'],
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects removing the caller through this endpoint', async () => {
      await expect(
        service.removeGroupMembers('user-1', 'conversation-1', {
          userIds: ['user-1'],
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(repository.removeGroupMembers).not.toHaveBeenCalled();
    });

    it('removes a deduped member list on success', async () => {
      repository.removeGroupMembers.mockResolvedValue({ count: 1 });

      await service.removeGroupMembers('user-1', 'conversation-1', {
        userIds: ['user-2', 'user-2'],
      });

      expect(repository.removeGroupMembers).toHaveBeenCalledWith(
        'conversation-1',
        ['user-2'],
      );
    });
  });

  describe('leaveGroup', () => {
    it('throws NotFoundException when the conversation is missing', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(null);

      await expect(
        service.leaveGroup('user-1', 'conversation-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the conversation is not a group', async () => {
      repository.findConversationWithParticipants.mockResolvedValue({
        id: 'conversation-1',
        type: 'DIRECT',
        participants: [],
      });

      await expect(
        service.leaveGroup('user-1', 'conversation-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the caller is not an active participant', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'MEMBER', state: 'DECLINED' },
        ]),
      );

      await expect(
        service.leaveGroup('user-1', 'conversation-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the owner tries to leave with other active members present', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'OWNER', state: 'ACTIVE' },
          { userId: 'user-2', role: 'MEMBER', state: 'ACTIVE' },
        ]),
      );

      await expect(
        service.leaveGroup('user-1', 'conversation-1'),
      ).rejects.toThrow(BadRequestException);

      expect(repository.removeGroupMembers).not.toHaveBeenCalled();
      expect(repository.updateParticipantState).not.toHaveBeenCalled();
    });

    it('allows the owner to leave when they are the only active member', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'OWNER', state: 'ACTIVE' },
          { userId: 'user-2', role: 'MEMBER', state: 'DECLINED' },
        ]),
      );
      repository.updateParticipantState.mockResolvedValue({
        userId: 'user-1',
        state: 'DECLINED',
      });

      await service.leaveGroup('user-1', 'conversation-1');

      expect(repository.updateParticipantState).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        'DECLINED',
      );
      expect(repository.removeGroupMembers).not.toHaveBeenCalled();
    });

    it('removes an active non-owner member on leave', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'MEMBER', state: 'ACTIVE' },
        ]),
      );
      repository.removeGroupMembers.mockResolvedValue({ count: 1 });

      await service.leaveGroup('user-1', 'conversation-1');

      expect(repository.removeGroupMembers).toHaveBeenCalledWith(
        'conversation-1',
        ['user-1'],
      );
    });
  });
  describe('transferGroupOwnership', () => {
    beforeEach(() => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'OWNER', state: 'ACTIVE' },
          { userId: 'user-2', role: 'MEMBER', state: 'ACTIVE' },
        ]),
      );
    });

    it('rejects a non-owner caller', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'ADMIN', state: 'ACTIVE' },
          { userId: 'user-2', role: 'MEMBER', state: 'ACTIVE' },
        ]),
      );

      await expect(
        service.transferGroupOwnership('user-1', 'conversation-1', {
          newOwnerUserId: 'user-2',
        } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.transferGroupOwnership).not.toHaveBeenCalled();
    });

    it('rejects transferring ownership to yourself', async () => {
      await expect(
        service.transferGroupOwnership('user-1', 'conversation-1', {
          newOwnerUserId: 'user-1',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the new owner is not an active participant', async () => {
      repository.findParticipant.mockResolvedValue(null);

      await expect(
        service.transferGroupOwnership('user-1', 'conversation-1', {
          newOwnerUserId: 'user-2',
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(repository.transferGroupOwnership).not.toHaveBeenCalled();
    });

    it('rejects when the new owner participant is not active', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-2',
        state: 'PENDING',
      });

      await expect(
        service.transferGroupOwnership('user-1', 'conversation-1', {
          newOwnerUserId: 'user-2',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('transfers ownership on success', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-2',
        state: 'ACTIVE',
      });
      repository.transferGroupOwnership.mockResolvedValue([{}, {}]);

      await service.transferGroupOwnership('user-1', 'conversation-1', {
        newOwnerUserId: 'user-2',
      });

      expect(repository.transferGroupOwnership).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        'user-2',
      );
    });
  });

  describe('updateGroupMemberRole', () => {
    beforeEach(() => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'OWNER', state: 'ACTIVE' },
          { userId: 'user-2', role: 'MEMBER', state: 'ACTIVE' },
        ]),
      );
    });

    it('rejects a non-owner caller', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'ADMIN', state: 'ACTIVE' },
          { userId: 'user-2', role: 'MEMBER', state: 'ACTIVE' },
        ]),
      );

      await expect(
        service.updateGroupMemberRole('user-1', 'conversation-1', 'user-2', {
          role: 'ADMIN',
        } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.updateParticipantRole).not.toHaveBeenCalled();
    });

    it('rejects changing your own role', async () => {
      await expect(
        service.updateGroupMemberRole('user-1', 'conversation-1', 'user-1', {
          role: 'ADMIN',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the target is not an active participant', async () => {
      repository.findParticipant.mockResolvedValue(null);

      await expect(
        service.updateGroupMemberRole('user-1', 'conversation-1', 'user-2', {
          role: 'ADMIN',
        } as any),
      ).rejects.toThrow(NotFoundException);

      expect(repository.updateParticipantRole).not.toHaveBeenCalled();
    });

    it("rejects changing the owner's role", async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-2',
        state: 'ACTIVE',
        role: 'OWNER',
      });

      await expect(
        service.updateGroupMemberRole('user-1', 'conversation-1', 'user-2', {
          role: 'ADMIN',
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(repository.updateParticipantRole).not.toHaveBeenCalled();
    });

    it('updates the role on success', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-2',
        state: 'ACTIVE',
        role: 'MEMBER',
      });
      repository.updateParticipantRole.mockResolvedValue({
        userId: 'user-2',
        role: 'ADMIN',
      });

      await service.updateGroupMemberRole(
        'user-1',
        'conversation-1',
        'user-2',
        {
          role: 'ADMIN',
        } as any,
      );

      expect(repository.updateParticipantRole).toHaveBeenCalledWith(
        'conversation-1',
        'user-2',
        'ADMIN',
      );
    });
  });

  describe('createDirectMessage', () => {
    beforeEach(() => {
      messageEncryption.preparePayload.mockResolvedValue({
        ciphertext: 'cipher',
        encryptionMeta: undefined,
      });
    });

    it('rejects messaging yourself', async () => {
      await expect(
        service.createDirectMessage('user-1', {
          recipientUserId: 'user-1',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the recipient does not exist', async () => {
      repository.findUserById.mockResolvedValue(null);

      await expect(
        service.createDirectMessage('user-1', {
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
        service.createDirectMessage('user-1', {
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
        service.createDirectMessage('user-1', {
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

      const result = await service.createDirectMessage('user-1', {
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
        service.createDirectMessage('user-1', {
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
        service.createDirectMessage('user-1', {
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

      const result = await service.createDirectMessage('user-1', {
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
        service.createDirectMessage('user-1', {
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
        service.createDirectMessage('user-1', {
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

      await service.createDirectMessage('user-1', {
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

      await service.createDirectMessage('user-1', {
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

      const result = await service.createDirectMessage('user-1', {
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

      await service.createDirectMessage('user-1', {
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

      await service.createDirectMessage('user-1', {
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

        const result = await service.createDirectMessage('user-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any);

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

        const result = await service.createDirectMessage('user-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any);

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
          service.createDirectMessage('user-1', {
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
          service.createDirectMessage('user-1', {
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

    it('returns duplicate immediately without checking the sender', async () => {
      repository.findMessageBySenderClientMessageId.mockResolvedValue({
        id: 'message-1',
        conversationId: 'conversation-1',
      });

      const result = await service.sendMessage('user-1', 'conversation-1', {
        message: { clientMessageId: 'client-1' },
      } as any);

      expect(result.duplicate).toBe(true);
      expect(repository.findParticipant).not.toHaveBeenCalled();
    });

    it('rejects when the sender is not a participant', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([{ userId: 'user-2', state: 'ACTIVE' }]),
      );

      await expect(
        service.sendMessage('user-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the sender participant is not active', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([{ userId: 'user-1', state: 'PENDING' }]),
      );

      await expect(
        service.sendMessage('user-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the conversation is not found', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findConversationWithParticipants.mockResolvedValue(null);

      await expect(
        service.sendMessage('user-1', 'conversation-1', {
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
        service.sendMessage('user-1', 'conversation-1', {
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
        service.sendMessage('user-1', 'conversation-1', {
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
        service.sendMessage('user-1', 'conversation-1', {
          message: {
            clientMessageId: 'client-1',
            replyToId: 'missing-message',
          },
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(repository.createMessage).not.toHaveBeenCalled();
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

      await service.sendMessage('user-1', 'conversation-1', {
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

      await service.sendMessage('user-1', 'conversation-1', {
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

      await service.sendMessage('user-1', 'conversation-1', {
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

      await service.sendMessage('user-1', 'conversation-1', {
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

      await service.sendMessage('user-1', 'conversation-1', {
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

      await service.sendMessage('user-1', 'conversation-1', {
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

      await service.sendMessage('user-1', 'conversation-1', {
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

      await service.sendMessage('user-1', 'conversation-1', {
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

    it('rejects a duplicate clientMessageId that belongs to a different conversation', async () => {
      repository.findMessageBySenderClientMessageId.mockResolvedValue({
        id: 'message-1',
        conversationId: 'a-different-conversation',
      });

      await expect(
        service.sendMessage('user-1', 'conversation-1', {
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

        const result = await service.sendMessage('user-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any);

        expect(result).toEqual({
          conversationId: 'conversation-1',
          message: { id: 'message-1', conversationId: 'conversation-1' },
          duplicate: true,
        });
      });

      it('rejects when the conflicting row cannot be found on recovery', async () => {
        repository.createMessage.mockRejectedValue(
          uniqueConstraintError('clientMessageId'),
        );
        repository.findMessageBySenderClientMessageId.mockResolvedValue(null);

        await expect(
          service.sendMessage('user-1', 'conversation-1', {
            message: { clientMessageId: 'client-1' },
          } as any),
        ).rejects.toThrow(ConflictException);
      });

      it('rethrows an unrelated error untouched', async () => {
        const unrelated = new Error('db connection lost');
        repository.createMessage.mockRejectedValue(unrelated);

        await expect(
          service.sendMessage('user-1', 'conversation-1', {
            message: { clientMessageId: 'client-1' },
          } as any),
        ).rejects.toBe(unrelated);
      });
    });
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
      targetState: string;
    }> = [
      {
        name: 'acceptRequest',
        call: (u, c) => service.acceptRequest(u, c),
        targetState: 'ACTIVE',
      },
      {
        name: 'declineRequest',
        call: (u, c) => service.declineRequest(u, c),
        targetState: 'DECLINED',
      },
    ];

    it.each(requestMethods)(
      '$name rejects when the conversation is not found',
      async ({ call }) => {
        repository.findParticipant.mockResolvedValue(null);

        await expect(call('user-1', 'conversation-1')).rejects.toThrow(
          NotFoundException,
        );
      },
    );

    it.each(requestMethods)(
      '$name rejects when the conversation is not pending',
      async ({ call }) => {
        repository.findParticipant.mockResolvedValue({
          userId: 'user-1',
          state: 'ACTIVE',
        });

        await expect(call('user-1', 'conversation-1')).rejects.toThrow(
          BadRequestException,
        );
      },
    );

    it.each(requestMethods)(
      '$name moves a pending conversation to $targetState',
      async ({ call, targetState }) => {
        repository.findParticipant.mockResolvedValue({
          userId: 'user-1',
          state: 'PENDING',
        });

        await call('user-1', 'conversation-1');

        expect(repository.updateParticipantState).toHaveBeenCalledWith(
          'conversation-1',
          'user-1',
          targetState,
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

    it('rejects a pending group invitee before they accept', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'PENDING',
      });
      repository.findConversationType.mockResolvedValue({ type: 'GROUP' });

      await expect(
        service.findMessages('user-1', 'conversation-1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a pending direct message request to preview history', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'PENDING',
      });
      repository.findConversationType.mockResolvedValue({ type: 'DIRECT' });
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
