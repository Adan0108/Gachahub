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
    findUserBlock: jest.fn(),
    findSentMessageInConversation: jest.fn(),
    createMessage: jest.fn(),
    updateParticipantArchivedState: jest.fn(),
    findGameById: jest.fn(),
    findGameModerator: jest.fn(),
    createGameChatEmote: jest.fn(),
    findMessageWithParticipants: jest.fn(),
    upsertMessageReaction: jest.fn(),
    findUsableChatEmote: jest.fn(),
    deleteMessageReaction: jest.fn(),
    updateParticipantState: jest.fn(),
    updateParticipantMutedAt: jest.fn(),
    updateParticipantPinnedAt: jest.fn(),
    blockUser: jest.fn(),
    unblockUser: jest.fn(),
    markMessagesDelivered: jest.fn(),
    markConversationRead: jest.fn(),
    updateMessage: jest.fn(),
    softDeleteMessage: jest.fn(),
    findInboxConversations: jest.fn(),
    countUnreadMessages: jest.fn(),
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

  const directConversation = (
    participants: Array<{
      userId: string;
      state: string;
      mutedAt?: Date | null;
    }>,
  ) => ({
    id: 'conversation-1',
    type: 'DIRECT',
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
      repository.findUserBlock.mockResolvedValue({
        blockerId: 'user-1',
        blockedId: 'user-2',
      });

      await expect(
        service.createDirectMessage('user-1', {
          recipientUserId: 'user-2',
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns duplicate when a message with the same clientMessageId exists', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      repository.findUserBlock.mockResolvedValue(null);
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
      expect(repository.findDirectPair).not.toHaveBeenCalled();
    });

    it('rejects a reply target when there is no existing conversation', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      repository.findUserBlock.mockResolvedValue(null);
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
      repository.findUserBlock.mockResolvedValue(null);
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

    it('delegates to the existing conversation when a direct pair already exists', async () => {
      repository.findUserById.mockResolvedValue({
        id: 'user-2',
        status: 'ACTIVE',
      });
      repository.findUserBlock.mockResolvedValue(null);
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findDirectPair.mockResolvedValue({
        conversation: { id: 'conversation-1' },
      });
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', mutedAt: null },
        { userId: 'user-2', state: 'ACTIVE', mutedAt: null },
      ]);
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
  });

  describe('sendMessage (existing conversation)', () => {
    beforeEach(() => {
      messageEncryption.preparePayload.mockResolvedValue({
        ciphertext: 'cipher',
        encryptionMeta: undefined,
      });
      repository.findMessageBySenderClientMessageId.mockResolvedValue(null);
      repository.findUserBlock.mockResolvedValue(null);
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
      repository.findParticipant.mockResolvedValue(null);

      await expect(
        service.sendMessage('user-1', 'conversation-1', {
          message: { clientMessageId: 'client-1' },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the sender participant is not active', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'PENDING',
      });

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
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', mutedAt: null },
      ]);
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
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', mutedAt: null },
        { userId: 'user-2', state: 'ACTIVE', mutedAt: null },
      ]);
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      repository.findUserBlock.mockResolvedValue({
        blockerId: 'user-1',
        blockedId: 'user-2',
      });

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
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', mutedAt: null },
        { userId: 'user-2', state: 'DECLINED', mutedAt: null },
      ]);
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
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', mutedAt: null },
        { userId: 'user-2', state: 'ACTIVE', mutedAt: null },
      ]);
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
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', mutedAt: null },
        { userId: 'user-2', state: 'ACTIVE', mutedAt: null },
      ]);
      repository.findConversationWithParticipants.mockResolvedValue(
        directConversation([
          { userId: 'user-1', state: 'ACTIVE' },
          { userId: 'user-2', state: 'ACTIVE' },
        ]),
      );
      repository.findUserBlock.mockImplementation((blockerId, blockedId) => {
        if (blockerId === 'user-2' && blockedId === 'user-1') {
          return Promise.resolve({ blockerId: 'user-2', blockedId: 'user-1' });
        }
        return Promise.resolve(null);
      });
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
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', mutedAt: null },
        { userId: 'user-2', state: 'ACTIVE', mutedAt: new Date() },
        { userId: 'user-3', state: 'ACTIVE', mutedAt: null },
      ]);
      repository.findConversationWithParticipants.mockResolvedValue(
        groupConversation([
          { userId: 'user-1', role: 'OWNER', state: 'ACTIVE' },
          { userId: 'user-2', role: 'MEMBER', state: 'ACTIVE' },
          { userId: 'user-3', role: 'MEMBER', state: 'ACTIVE' },
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

    it('unarchives an archived recipient when a new message arrives', async () => {
      repository.findParticipant.mockResolvedValue({
        userId: 'user-1',
        state: 'ACTIVE',
      });
      repository.findParticipants.mockResolvedValue([
        { userId: 'user-1', state: 'ACTIVE', mutedAt: null },
        { userId: 'user-2', state: 'ARCHIVED', mutedAt: null },
      ]);
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

      expect(repository.updateParticipantArchivedState).toHaveBeenCalledWith(
        'conversation-1',
        'user-2',
        false,
      );
    });
  });

  describe('createGameEmote', () => {
    it('rejects when the game does not exist', async () => {
      repository.findGameById.mockResolvedValue(null);

      await expect(
        service.createGameEmote('user-1', 'game-1', {
          shortcode: 'catcooking',
          unicode: '\\u{1F639}',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a caller who is neither admin nor game moderator', async () => {
      repository.findGameById.mockResolvedValue({ id: 'game-1' });
      repository.findUserById.mockResolvedValue({ id: 'user-1', role: 'USER' });
      repository.findGameModerator.mockResolvedValue(null);

      await expect(
        service.createGameEmote('user-1', 'game-1', {
          shortcode: 'catcooking',
          unicode: '\\u{1F639}',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an app admin regardless of moderator assignment', async () => {
      repository.findGameById.mockResolvedValue({ id: 'game-1' });
      repository.findUserById.mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
      });
      repository.createGameChatEmote.mockResolvedValue({ id: 'emote-1' });

      await service.createGameEmote('user-1', 'game-1', {
        shortcode: 'catcooking',
        unicode: '\\u{1F639}',
      });

      expect(repository.findGameModerator).not.toHaveBeenCalled();
      expect(repository.createGameChatEmote).toHaveBeenCalled();
    });

    it('allows an assigned game moderator', async () => {
      repository.findGameById.mockResolvedValue({ id: 'game-1' });
      repository.findUserById.mockResolvedValue({ id: 'user-1', role: 'USER' });
      repository.findGameModerator.mockResolvedValue({
        gameId: 'game-1',
        userId: 'user-1',
      });
      repository.createGameChatEmote.mockResolvedValue({ id: 'emote-1' });

      await service.createGameEmote('user-1', 'game-1', {
        shortcode: 'catcooking',
        unicode: '\\u{1F639}',
      });

      expect(repository.createGameChatEmote).toHaveBeenCalled();
    });

    it('rejects an emote with no renderable value', async () => {
      repository.findGameById.mockResolvedValue({ id: 'game-1' });
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
      repository.findGameById.mockResolvedValue({ id: 'game-1' });
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
        name: 'muteConversation',
        call: (u, c) => service.muteConversation(u, c),
      },
      {
        name: 'unmuteConversation',
        call: (u, c) => service.unmuteConversation(u, c),
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

    it('muteConversation sets mutedAt to a timestamp', async () => {
      await service.muteConversation('user-1', 'conversation-1');

      expect(repository.updateParticipantMutedAt).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        expect.any(Date),
      );
    });

    it('unmuteConversation clears mutedAt', async () => {
      await service.unmuteConversation('user-1', 'conversation-1');

      expect(repository.updateParticipantMutedAt).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        null,
      );
    });

    it('archiveConversation sets archived to true', async () => {
      await service.archiveConversation('user-1', 'conversation-1');

      expect(repository.updateParticipantArchivedState).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
        true,
      );
    });

    it('unarchiveConversation sets archived to false', async () => {
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
      repository.blockUser.mockResolvedValue({
        blockerId: 'user-1',
        blockedId: 'user-2',
      });

      await service.blockUser('user-1', 'user-2');

      expect(repository.blockUser).toHaveBeenCalledWith('user-1', 'user-2');
    });
  });

  describe('unblockUser', () => {
    it('rejects unblocking yourself', async () => {
      await expect(service.unblockUser('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('removes the block and returns the count on success', async () => {
      repository.unblockUser.mockResolvedValue({ count: 1 });

      const result = await service.unblockUser('user-1', 'user-2');

      expect(repository.unblockUser).toHaveBeenCalledWith('user-1', 'user-2');
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
      repository.countUnreadMessages.mockResolvedValue(0);

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
});
