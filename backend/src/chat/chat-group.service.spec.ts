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
import { ChatGroupService } from './chat-group.service';

describe('ChatGroupService', () => {
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

  let chatAccessService: ChatAccessService;
  let service: ChatGroupService;

  beforeEach(() => {
    jest.clearAllMocks();
    chatAccessService = new ChatAccessService(
      repository as any,
      followsService as any,
      blocksService as any,
      gameModeratorsService as any,
    );
    service = new ChatGroupService(repository as any, chatAccessService);
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
});
