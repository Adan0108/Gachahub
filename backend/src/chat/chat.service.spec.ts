import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
jest.mock('./chat.repository', () => ({
  ChatRepository: class {},
}));
jest.mock('../generated/prisma/client', () => ({
  ChatMessageContentType: { TEXT: 'TEXT' },
  UserRole: { ADMIN: 'ADMIN' },
}));

import { ChatService } from './chat.service';

describe('ChatService - group chat', () => {
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
  };

  const messageEncryption = {
    preparePayload: jest.fn(),
  };

  const chatDelivery = {
    publishMessageCreated: jest.fn(),
  };

  let service: ChatService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatService(
      repository as any,
      messageEncryption,
      chatDelivery,
    );
  });

  const groupConversation = (
    participants: Array<{ userId: string; role: string; state: string }>,
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
        memberUserIds: ['user-2', 'user-3'],
      });
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
        ['user-2', 'user-3'],
      );
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

    it('throws BadRequestException when the owner tries to leave', async () => {
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'OWNER', state: 'ACTIVE' },
        ]),
      );

      await expect(
        service.leaveGroup('user-1', 'conversation-1'),
      ).rejects.toThrow(BadRequestException);

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
      } as any);

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

      await service.updateGroupMemberRole('user-1', 'conversation-1', 'user-2', {
        role: 'ADMIN',
      } as any);

      expect(repository.updateParticipantRole).toHaveBeenCalledWith(
        'conversation-1',
        'user-2',
        'ADMIN',
      );
    });
  });
});
