import { ChatInviteExpiryService } from './chat-invite-expiry.service';

describe('ChatInviteExpiryService', () => {
  const chatMembershipRepository = {
    findExpiredPendingInvites: jest.fn(),
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
