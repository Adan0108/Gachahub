jest.mock('../discord/discord-logger.service', () => ({
  DiscordLoggerService: class {},
}));

import { IntegrityCheckRegistry } from './integrity-check.registry';
import { IntegrityService } from './integrity.service';

describe('IntegrityService', () => {
  const discordLogger = { sendError: jest.fn() };

  let registry: IntegrityCheckRegistry;
  let service: IntegrityService;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new IntegrityCheckRegistry();
    service = new IntegrityService(registry, discordLogger as never);
  });

  it('stays quiet while every registered invariant holds', async () => {
    registry.register({
      name: 'demo',
      title: 'Demo invariant broken',
      source: 'mls',
      findViolations: () => Promise.resolve([]),
    });

    await service.runChecks();

    expect(discordLogger.sendError).not.toHaveBeenCalled();
  });

  it('alerts with the check name and sampled examples when an invariant is violated', async () => {
    registry.register({
      name: 'demo',
      title: 'Demo invariant broken',
      source: 'mls',
      findViolations: () => Promise.resolve(['row-1', 'row-2']),
    });

    await service.runChecks();

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Demo invariant broken',
        dedupKey: 'Integrity:demo',
      }),
    );
  });

  it('reports a check that itself crashes, and still runs the rest', async () => {
    registry.register(
      {
        name: 'broken',
        title: 'x',
        source: 'mls',
        findViolations: () => Promise.reject(new Error('db down')),
      },
      {
        name: 'healthy-but-violated',
        title: 'Second invariant broken',
        source: 'mls',
        findViolations: () => Promise.resolve(['row-1']),
      },
    );

    await service.runChecks();

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Integrity check failed to run: broken',
      }),
    );
    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'Integrity:healthy-but-violated' }),
    );
  });
});
