import type { ChatMembershipRepository } from './chat-membership.repository';

jest.mock('./chat-membership.repository', () => ({
  ChatMembershipRepository: class {},
}));

import { ChatMembershipService } from './chat-membership.service';

describe('ChatMembershipService', () => {
  const repository = {
    changeMembership: jest.fn(),
    changeMembershipInTransaction: jest.fn(),
  };
  const eventPublisher = { publish: jest.fn(), publishMany: jest.fn() };
  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback('fake-tx'),
    ),
  };

  let service: ChatMembershipService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback('fake-tx'),
    );
    repository.changeMembership.mockImplementation(
      (_conversationId: string, requests: unknown[]) =>
        Promise.resolve(requests.length),
    );
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
        'fake-tx',
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
        'fake-tx',
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
        'fake-tx',
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
        'fake-tx',
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
        'fake-tx',
        'conv-1',
        [{ userId: 'u2', event: 'ADD_DIRECT' }],
      );
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
