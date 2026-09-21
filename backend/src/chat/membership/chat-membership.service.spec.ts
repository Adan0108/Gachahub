import { BadRequestException } from '@nestjs/common';
import type { MlsGroupRosterRepository } from '../../mls-group-roster/mls-group-roster.repository';
import type { ChatRepository } from '../chat.repository';

jest.mock('../chat.repository', () => ({ ChatRepository: class {} }));
jest.mock('../../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { ChatMembershipService } from './chat-membership.service';

describe('ChatMembershipService', () => {
  const chatRepository = {
    findParticipantsByUserIds: jest.fn(),
    applyStateTransitions: jest.fn(),
  };
  const roster = { hasRoster: jest.fn() };

  let service: ChatMembershipService;

  const participant = (userId: string, state: string, role = 'MEMBER') => ({
    userId,
    state,
    role,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    roster.hasRoster.mockResolvedValue(true);
    chatRepository.findParticipantsByUserIds.mockResolvedValue([]);
    chatRepository.applyStateTransitions.mockImplementation(
      (_conversationId: string, changes: unknown[]) =>
        Promise.resolve(changes.length),
    );

    service = new ChatMembershipService(
      chatRepository as unknown as ChatRepository,
      roster as unknown as MlsGroupRosterRepository,
    );
  });

  describe('addMembers', () => {
    it('sends someone entitled to join straight to JOINING when the conversation has an MLS group', async () => {
      await expect(
        service.addMembers('conv-1', [{ userId: 'u2', entitlement: 'DIRECT' }]),
      ).resolves.toEqual({ count: 1 });

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: null, to: 'JOINING' }],
      );
    });

    it('makes them ACTIVE straight away when there is no MLS group yet', async () => {
      roster.hasRoster.mockResolvedValue(false);

      await service.addMembers('conv-1', [
        { userId: 'u2', entitlement: 'DIRECT' },
      ]);

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: null, to: 'ACTIVE' }],
      );
    });

    it('asks an invitee to accept first, in either case', async () => {
      await service.addMembers('conv-1', [
        { userId: 'u2', entitlement: 'INVITE' },
      ]);

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: null, to: 'PENDING' }],
      );
    });

    it('records the state it read, so a concurrent change is caught by the conditional write', async () => {
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'DECLINED'),
      ]);

      await service.addMembers('conv-1', [
        { userId: 'u2', entitlement: 'DIRECT' },
      ]);

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: 'DECLINED', to: 'JOINING' }],
      );
    });

    it('leaves people who are already members alone', async () => {
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'ACTIVE'),
        participant('u3', 'BLOCKED'),
      ]);

      await expect(
        service.addMembers('conv-1', [
          { userId: 'u2', entitlement: 'DIRECT' },
          { userId: 'u3', entitlement: 'DIRECT' },
        ]),
      ).resolves.toEqual({ count: 0 });

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [],
      );
    });

    it('cancels a pending removal instead of re-adding someone whose devices are still in the group', async () => {
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'LEAVING'),
      ]);

      await service.addMembers('conv-1', [
        { userId: 'u2', entitlement: 'DIRECT' },
      ]);

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: 'LEAVING', to: 'ACTIVE' }],
      );
    });

    it('applies one change per person when the same user is listed twice', async () => {
      await service.addMembers('conv-1', [
        { userId: 'u2', entitlement: 'DIRECT' },
        { userId: 'u2', entitlement: 'DIRECT' },
      ]);

      expect(chatRepository.findParticipantsByUserIds).toHaveBeenCalledWith(
        'conv-1',
        ['u2'],
      );
      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: null, to: 'JOINING' }],
      );
    });
  });

  describe('removeMembers', () => {
    it('moves someone holding a device in the group to LEAVING', async () => {
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'ACTIVE'),
      ]);

      await service.removeMembers('conv-1', ['u2']);

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: 'ACTIVE', to: 'LEAVING' }],
      );
    });

    it('declines someone who never had a device in the group', async () => {
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'PENDING'),
        participant('u3', 'JOINING'),
      ]);

      await service.removeMembers('conv-1', ['u2', 'u3']);

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [
          { userId: 'u2', from: 'PENDING', to: 'DECLINED' },
          { userId: 'u3', from: 'JOINING', to: 'DECLINED' },
        ],
      );
    });

    it('declines directly when there is no MLS group, as before', async () => {
      roster.hasRoster.mockResolvedValue(false);
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'ACTIVE'),
      ]);

      await service.removeMembers('conv-1', ['u2']);

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: 'ACTIVE', to: 'DECLINED' }],
      );
    });

    it('skips owners - ownership must be transferred first', async () => {
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u1', 'ACTIVE', 'OWNER'),
      ]);

      await expect(service.removeMembers('conv-1', ['u1'])).resolves.toEqual({
        count: 0,
      });
      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [],
      );
    });

    it('is a no-op for someone already leaving, already gone, or not in the conversation', async () => {
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'LEAVING'),
        participant('u3', 'DECLINED'),
      ]);

      await expect(
        service.removeMembers('conv-1', ['u2', 'u3', 'u4']),
      ).resolves.toEqual({ count: 0 });
    });
  });

  describe('acceptInvite / declineInvite', () => {
    it('moves a pending invitee to JOINING when the conversation has an MLS group', async () => {
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'PENDING'),
      ]);

      await service.acceptInvite('conv-1', 'u2');

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: 'PENDING', to: 'JOINING' }],
      );
    });

    it('moves a pending invitee straight to ACTIVE without one', async () => {
      roster.hasRoster.mockResolvedValue(false);
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'PENDING'),
      ]);

      await service.acceptInvite('conv-1', 'u2');

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: 'PENDING', to: 'ACTIVE' }],
      );
    });

    it('declines a pending invitee', async () => {
      chatRepository.findParticipantsByUserIds.mockResolvedValue([
        participant('u2', 'PENDING'),
      ]);

      await service.declineInvite('conv-1', 'u2');

      expect(chatRepository.applyStateTransitions).toHaveBeenCalledWith(
        'conv-1',
        [{ userId: 'u2', from: 'PENDING', to: 'DECLINED' }],
      );
    });

    it.each(['ACTIVE', 'DECLINED', 'JOINING', 'LEAVING'])(
      'rejects accepting or declining from %s with the "not pending" message and writes nothing',
      async (state) => {
        chatRepository.findParticipantsByUserIds.mockResolvedValue([
          participant('u2', state),
        ]);

        await expect(service.acceptInvite('conv-1', 'u2')).rejects.toThrow(
          new BadRequestException('Conversation is not pending'),
        );
        await expect(service.declineInvite('conv-1', 'u2')).rejects.toThrow(
          new BadRequestException('Conversation is not pending'),
        );
        expect(chatRepository.applyStateTransitions).not.toHaveBeenCalled();
      },
    );

    it('rejects when the user has no participant row at all', async () => {
      await expect(service.acceptInvite('conv-1', 'u2')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
