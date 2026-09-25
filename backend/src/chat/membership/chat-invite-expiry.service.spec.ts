import { ChatInviteExpiryService } from './chat-invite-expiry.service';

describe('ChatInviteExpiryService', () => {
  const chatMembershipRepository = {
    findExpiredPendingInvites: jest.fn(),
    stampMissingPendingSince: jest.fn(),
  };
  const chatMembershipService = {
    expireInvites: jest.fn(),
  };
  const discordLogger = {
    sendError: jest.fn(),
  };

  let service: ChatInviteExpiryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatInviteExpiryService(
      chatMembershipRepository as any,
      chatMembershipService as any,
      discordLogger as any,
    );
  });

  it('expires the invites the repository found, per conversation', async () => {
    chatMembershipRepository.findExpiredPendingInvites.mockResolvedValue(
      new Map([
        ['conv-1', ['u2', 'u3']],
        ['conv-2', ['u4']],
      ]),
    );
    chatMembershipService.expireInvites.mockResolvedValue({ count: 1 });

    await service.expireStaleInvites();

    expect(chatMembershipService.expireInvites).toHaveBeenCalledWith('conv-1', [
      'u2',
      'u3',
    ]);
    expect(chatMembershipService.expireInvites).toHaveBeenCalledWith('conv-2', [
      'u4',
    ]);
    expect(discordLogger.sendError).not.toHaveBeenCalled();
  });

  it('starts the expiry clock of PENDING rows that have no pendingSince before looking for expired ones', async () => {
    chatMembershipRepository.findExpiredPendingInvites.mockResolvedValue(
      new Map(),
    );

    await service.expireStaleInvites();

    const stampOrder =
      chatMembershipRepository.stampMissingPendingSince.mock
        .invocationCallOrder[0];
    const findOrder =
      chatMembershipRepository.findExpiredPendingInvites.mock
        .invocationCallOrder[0];
    expect(stampOrder).toBeLessThan(findOrder);
    const [stampedAt] = chatMembershipRepository.stampMissingPendingSince.mock
      .calls[0] as [Date];
    const [cutoff] = chatMembershipRepository.findExpiredPendingInvites.mock
      .calls[0] as [Date];
    expect(stampedAt.getTime() - cutoff.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
  });

  it('keeps sweeping full batches until a short one drains the backlog', async () => {
    const fullBatch = new Map([
      ['conv-1', Array.from({ length: 500 }, (_, i) => `u${i}`)],
    ]);
    chatMembershipRepository.findExpiredPendingInvites
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce(new Map([['conv-2', ['x']]]));
    chatMembershipService.expireInvites.mockResolvedValue({ count: 1 });

    await service.expireStaleInvites();

    expect(
      chatMembershipRepository.findExpiredPendingInvites,
    ).toHaveBeenCalledTimes(2);
    const [, limit] = chatMembershipRepository.findExpiredPendingInvites.mock
      .calls[0] as [Date, number];
    expect(limit).toBe(500);
  });

  it('stops when a full batch makes no progress instead of refetching it forever', async () => {
    chatMembershipRepository.findExpiredPendingInvites.mockResolvedValue(
      new Map([['conv-1', Array.from({ length: 500 }, (_, i) => `u${i}`)]]),
    );
    chatMembershipService.expireInvites.mockRejectedValue(new Error('boom'));

    await service.expireStaleInvites();

    expect(
      chatMembershipRepository.findExpiredPendingInvites,
    ).toHaveBeenCalledTimes(1);
  });

  it('uses a 14-day cutoff', async () => {
    chatMembershipRepository.findExpiredPendingInvites.mockResolvedValue(
      new Map(),
    );

    await service.expireStaleInvites();

    const [cutoff] = chatMembershipRepository.findExpiredPendingInvites.mock
      .calls[0] as [Date];
    const daysAgo = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(daysAgo)).toBe(14);
  });

  it('does nothing when nothing has expired', async () => {
    chatMembershipRepository.findExpiredPendingInvites.mockResolvedValue(
      new Map(),
    );

    await expect(service.expireStaleInvites()).resolves.toBeUndefined();

    expect(chatMembershipService.expireInvites).not.toHaveBeenCalled();
    expect(discordLogger.sendError).not.toHaveBeenCalled();
  });

  it('isolates one conversation failing so the rest of the sweep still runs', async () => {
    chatMembershipRepository.findExpiredPendingInvites.mockResolvedValue(
      new Map([
        ['conv-1', ['u2']],
        ['conv-2', ['u3']],
      ]),
    );
    chatMembershipService.expireInvites
      .mockRejectedValueOnce(new Error('someone already accepted'))
      .mockResolvedValueOnce({ count: 1 });

    await service.expireStaleInvites();

    expect(chatMembershipService.expireInvites).toHaveBeenCalledTimes(2);
    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Cron job partially failed: expireStaleInvites',
      }),
    );
  });

  it('reports to discord instead of throwing when the read itself fails', async () => {
    chatMembershipRepository.findExpiredPendingInvites.mockRejectedValue(
      new Error('db down'),
    );

    await expect(service.expireStaleInvites()).resolves.toBeUndefined();

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Cron job failed: expireStaleInvites',
      }),
    );
  });
});
