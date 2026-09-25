import type { ChatMembershipRepository } from './chat-membership.repository';

jest.mock('./chat-membership.repository', () => ({
  ChatMembershipRepository: class {},
}));

import { ChatMembershipService } from './chat-membership.service';

describe('ChatMembershipService', () => {
  const repository = { changeMembership: jest.fn() };

  let service: ChatMembershipService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.changeMembership.mockImplementation(
      (_conversationId: string, requests: unknown[]) =>
        Promise.resolve(requests.length),
    );

    service = new ChatMembershipService(
      repository as unknown as ChatMembershipRepository,
    );
  });

  it('turns an add into a direct or an invite event depending on how the person gets in', async () => {
    await expect(
      service.addMembers('conv-1', [
        { userId: 'u2', entitlement: 'DIRECT' },
        { userId: 'u3', entitlement: 'INVITE' },
      ]),
    ).resolves.toEqual({ count: 2 });

    expect(repository.changeMembership).toHaveBeenCalledWith(
      'conv-1',
      [
        { userId: 'u2', event: 'ADD_DIRECT' },
        { userId: 'u3', event: 'ADD_INVITE' },
      ],
      undefined,
    );
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

  it('applies one change per person when the same user is listed twice', async () => {
    await service.addMembers('conv-1', [
      { userId: 'u2', entitlement: 'DIRECT' },
      { userId: 'u2', entitlement: 'DIRECT' },
    ]);

    expect(repository.changeMembership).toHaveBeenCalledWith(
      'conv-1',
      [{ userId: 'u2', event: 'ADD_DIRECT' }],
      undefined,
    );
  });

  it('reports how many people actually changed', async () => {
    repository.changeMembership.mockResolvedValue(1);

    await expect(
      service.removeMembers('conv-1', ['u2', 'u3']),
    ).resolves.toEqual({ count: 1 });
  });
});
