jest.mock('./mls-audit.repository', () => ({ MlsAuditRepository: class {} }));
jest.mock('../common/discord/discord-logger.service', () => ({
  DiscordLoggerService: class {},
}));

import { MlsAuditService } from './mls-audit.service';

describe('MlsAuditService', () => {
  const repository = {
    findLeavesOfDeadDevices: jest.fn(),
    findLeavesOfOutsiders: jest.fn(),
    findStuckParticipants: jest.fn(),
  };
  const discordLogger = { sendError: jest.fn() };

  let service: MlsAuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findLeavesOfDeadDevices.mockResolvedValue([]);
    repository.findLeavesOfOutsiders.mockResolvedValue([]);
    repository.findStuckParticipants.mockResolvedValue([]);
    service = new MlsAuditService(repository as never, discordLogger as never);
  });

  it('stays quiet when everything checks out', async () => {
    await service.auditGroups();

    expect(discordLogger.sendError).not.toHaveBeenCalled();
  });

  it('alerts when a device is in a group whose conversation its owner is not in', async () => {
    repository.findLeavesOfOutsiders.mockResolvedValue([
      { conversationId: 'conv-1', deviceId: 'd1', userId: 'intruder' },
    ]);

    await service.auditGroups();

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'MlsAudit:outsider' }),
    );
  });

  it('alerts on dead devices still in groups, and on stuck joins or removals', async () => {
    repository.findLeavesOfDeadDevices.mockResolvedValue([
      { conversationId: 'conv-1', deviceId: 'd1', userId: 'u1' },
    ]);
    repository.findStuckParticipants.mockResolvedValue([
      { conversationId: 'conv-2', userId: 'u2', state: 'LEAVING' },
    ]);

    await service.auditGroups();

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'MlsAudit:dead-device' }),
    );
    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'MlsAudit:stuck' }),
    );
  });

  it('reports its own failure to the cron channel instead of throwing', async () => {
    repository.findLeavesOfDeadDevices.mockRejectedValue(new Error('db down'));

    await expect(service.auditGroups()).resolves.toBeUndefined();

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'cron' }),
    );
  });
});
