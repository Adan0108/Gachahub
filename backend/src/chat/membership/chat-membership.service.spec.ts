import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ChatMembershipRepository } from './chat-membership.repository';

jest.mock('./chat-membership.repository', () => ({
  ChatMembershipRepository: class {},
}));

import { ChatMembershipService } from './chat-membership.service';

describe('ChatMembershipService', () => {
  const repository = {
    changeMembership: jest.fn(),
    changeMembershipInTransaction: jest.fn(),
    countGroupMembers: jest.fn(),
  };
  const eventPublisher = { publish: jest.fn(), publishMany: jest.fn() };
  // The locked actor lookup: the actor still manages the group unless a test revokes them via actorRow
  let actorRow: { state: string; role: string } | null;
  const fakeTx = {
    $queryRaw: jest.fn(),
    chatParticipant: { findUnique: jest.fn(() => Promise.resolve(actorRow)) },
  };
  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback(fakeTx),
    ),
  };

  let service: ChatMembershipService;

  beforeEach(() => {
    jest.clearAllMocks();
    actorRow = { state: 'ACTIVE', role: 'OWNER' };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    repository.changeMembership.mockImplementation(
      (_conversationId: string, requests: unknown[]) =>
        Promise.resolve(requests.length),
    );
    repository.countGroupMembers.mockResolvedValue(3);
    repository.changeMembershipInTransaction.mockImplementation(
      (_tx: unknown, _conversationId: string, requests: unknown[]) =>
        // Default double: every request became a genuine ACTIVE transition. Individual tests
        // override this when they need to simulate a JOINING result or a no-op exclusion.
        Promise.resolve(
          (requests as Array<{ userId: string }>).map((request) => ({
            userId: request.userId,
            from: null,
            to: 'ACTIVE',
          })),
        ),
    );

    service = new ChatMembershipService(
      repository as unknown as ChatMembershipRepository,
      eventPublisher,
      prisma as any,
    );
  });

  describe('addMembers', () => {
    it('turns an add into a direct or an invite event depending on how the person gets in', async () => {
      await expect(
        service.addMembers(
          'conv-1',
          [
            { userId: 'u2', entitlement: 'DIRECT' },
            { userId: 'u3', entitlement: 'INVITE' },
          ],
          'actor-1',
        ),
      ).resolves.toEqual({ count: 2 });

      expect(repository.changeMembershipInTransaction).toHaveBeenCalledWith(
        fakeTx,
        'conv-1',
        [
          { userId: 'u2', event: 'ADD_DIRECT' },
          { userId: 'u3', event: 'ADD_INVITE' },
        ],
      );
    });

    it('publishes one chat.participant.added per transition actually applied, via publishMany in the same transaction', async () => {
      repository.changeMembershipInTransaction.mockResolvedValue([
        { userId: 'u2', from: null, to: 'ACTIVE' },
        { userId: 'u3', from: null, to: 'PENDING' },
      ]);

      await service.addMembers(
        'conv-1',
        [
          { userId: 'u2', entitlement: 'DIRECT' },
          { userId: 'u3', entitlement: 'INVITE' },
        ],
        'actor-1',
      );

      expect(eventPublisher.publishMany).toHaveBeenCalledWith(
        [
          {
            type: 'chat.participant.added',
            aggregateId: 'conv-1',
            payload: {
              conversationId: 'conv-1',
              addedUserId: 'u2',
              actorId: 'actor-1',
              state: 'ACTIVE',
            },
          },
          {
            type: 'chat.participant.added',
            aggregateId: 'conv-1',
            payload: {
              conversationId: 'conv-1',
              addedUserId: 'u3',
              actorId: 'actor-1',
              state: 'PENDING',
            },
          },
        ],
        fakeTx,
      );
    });

    it('publishes JOINING (not ACTIVE) when a direct add lands there because MLS is already active', async () => {
      repository.changeMembershipInTransaction.mockResolvedValue([
        { userId: 'u2', from: null, to: 'JOINING' },
      ]);

      await service.addMembers(
        'conv-1',
        [{ userId: 'u2', entitlement: 'DIRECT' }],
        'actor-1',
      );

      expect(eventPublisher.publishMany).toHaveBeenCalledWith(
        [
          {
            type: 'chat.participant.added',
            aggregateId: 'conv-1',
            payload: {
              conversationId: 'conv-1',
              addedUserId: 'u2',
              actorId: 'actor-1',
              state: 'JOINING',
            },
          },
        ],
        fakeTx,
      );
    });

    it('does not notify someone whose add was a no-op (already a member)', async () => {
      // u3 was already ACTIVE, so the real repository's planMembershipChanges resolves that to
      // 'noop' and never includes it in the returned transitions - only u2's genuine add is here.
      repository.changeMembershipInTransaction.mockResolvedValue([
        { userId: 'u2', from: null, to: 'ACTIVE' },
      ]);

      const result = await service.addMembers(
        'conv-1',
        [
          { userId: 'u2', entitlement: 'DIRECT' },
          { userId: 'u3', entitlement: 'DIRECT' },
        ],
        'actor-1',
      );

      expect(result).toEqual({ count: 1 });
      expect(eventPublisher.publishMany).toHaveBeenCalledWith(
        [
          {
            type: 'chat.participant.added',
            aggregateId: 'conv-1',
            payload: {
              conversationId: 'conv-1',
              addedUserId: 'u2',
              actorId: 'actor-1',
              state: 'ACTIVE',
            },
          },
        ],
        fakeTx,
      );
    });

    it('does not publish anything when every requested add was a no-op', async () => {
      repository.changeMembershipInTransaction.mockResolvedValue([]);

      const result = await service.addMembers(
        'conv-1',
        [{ userId: 'u2', entitlement: 'DIRECT' }],
        'actor-1',
      );

      expect(result).toEqual({ count: 0 });
      expect(eventPublisher.publishMany).not.toHaveBeenCalled();
    });

    it('applies one change per person when the same user is listed twice', async () => {
      await service.addMembers(
        'conv-1',
        [
          { userId: 'u2', entitlement: 'DIRECT' },
          { userId: 'u2', entitlement: 'DIRECT' },
        ],
        'actor-1',
      );

      expect(repository.changeMembershipInTransaction).toHaveBeenCalledWith(
        fakeTx,
        'conv-1',
        [{ userId: 'u2', event: 'ADD_DIRECT' }],
      );
    });

    // #103: the count is taken under the lock after the write, so concurrent adds cannot both get in.
    it('refuses an add that takes the group past 100 members, and publishes nothing', async () => {
      repository.countGroupMembers.mockResolvedValue(101);

      await expect(
        service.addMembers(
          'conv-1',
          [{ userId: 'u2', entitlement: 'DIRECT' }],
          'actor-1',
        ),
      ).rejects.toThrow(
        new BadRequestException('A group can have at most 100 members'),
      );
      expect(repository.countGroupMembers).toHaveBeenCalledWith(
        fakeTx,
        'conv-1',
      );
      expect(eventPublisher.publishMany).not.toHaveBeenCalled();
    });

    it('lets an add that fills the group to exactly 100 through', async () => {
      repository.countGroupMembers.mockResolvedValue(100);

      await expect(
        service.addMembers(
          'conv-1',
          [{ userId: 'u2', entitlement: 'DIRECT' }],
          'actor-1',
        ),
      ).resolves.toEqual({ count: 1 });
    });
  });

  it('turns a removal into a REMOVE event per person', async () => {
    await service.removeMembers('conv-1', ['u2', 'u3']);

    expect(repository.changeMembership).toHaveBeenCalledWith(
      'conv-1',
      [
        { userId: 'u2', event: 'REMOVE' },
        { userId: 'u3', event: 'REMOVE' },
      ],
      undefined,
    );
  });

  // #94: the manager's role is checked again under the lock, after the caller's earlier check
  describe('when the acting manager loses their role before the write', () => {
    it.each([
      ['demoted', { state: 'ACTIVE', role: 'MEMBER' }],
      ['removed', { state: 'DECLINED', role: 'ADMIN' }],
    ])('refuses an add by a %s admin and changes nothing', async (_, row) => {
      actorRow = row;

      await expect(
        service.addMembers(
          'conv-1',
          [{ userId: 'u2', entitlement: 'DIRECT' }],
          'u1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.changeMembershipInTransaction).not.toHaveBeenCalled();
      expect(eventPublisher.publishMany).not.toHaveBeenCalled();
    });

    it('refuses a removal by a demoted admin and changes nothing', async () => {
      actorRow = { state: 'ACTIVE', role: 'MEMBER' };

      await expect(
        service.removeMembers('conv-1', ['u2'], 'u1'),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.changeMembershipInTransaction).not.toHaveBeenCalled();
    });

    it('still lets someone leave, which needs no role', async () => {
      actorRow = null;

      await service.removeMembers('conv-1', ['u1']);

      expect(repository.changeMembership).toHaveBeenCalled();
    });
  });

  it('accepts and declines an invite', async () => {
    await service.acceptInvite('conv-1', 'u2');
    await service.declineInvite('conv-1', 'u2');

    expect(repository.changeMembership).toHaveBeenNthCalledWith(
      1,
      'conv-1',
      [{ userId: 'u2', event: 'ACCEPT_INVITE' }],
      undefined,
    );
    expect(repository.changeMembership).toHaveBeenNthCalledWith(
      2,
      'conv-1',
      [{ userId: 'u2', event: 'DECLINE_INVITE' }],
      undefined,
    );
  });

  it('lets someone who declined a direct chat back in as a direct add, with no invite to answer', async () => {
    await service.reopenDirect('conv-1', 'u2');

    expect(repository.changeMembership).toHaveBeenCalledWith(
      'conv-1',
      [{ userId: 'u2', event: 'ADD_DIRECT' }],
      undefined,
    );
  });

  it('turns an expiry into an EXPIRE_INVITE event per person', async () => {
    await service.expireInvites('conv-1', ['u2', 'u3']);

    expect(repository.changeMembership).toHaveBeenCalledWith(
      'conv-1',
      [
        { userId: 'u2', event: 'EXPIRE_INVITE' },
        { userId: 'u3', event: 'EXPIRE_INVITE' },
      ],
      'skip',
    );
  });

  it('reports how many people actually changed', async () => {
    repository.changeMembership.mockResolvedValue(1);

    await expect(
      service.removeMembers('conv-1', ['u2', 'u3']),
    ).resolves.toEqual({ count: 1 });
  });
});
