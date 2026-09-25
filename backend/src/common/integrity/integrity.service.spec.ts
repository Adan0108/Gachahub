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

  it('does not let one hung check hold up the ones after it', async () => {
    jest.useFakeTimers();
    registry.register(
      {
        name: 'hangs-forever',
        title: 'x',
        source: 'mls',
        findViolations: () => new Promise(() => undefined),
      },
      {
        name: 'runs-fine',
        title: 'Runs fine invariant broken',
        source: 'mls',
        findViolations: () => Promise.resolve(['row-1']),
      },
    );

    const run = service.runChecks();
    await jest.runAllTimersAsync();
    await run;

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Integrity check failed to run: hangs-forever',
      }),
    );
    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'Integrity:runs-fine' }),
    );
    jest.useRealTimers();
  });

  it('skips a sweep that starts while the last one is still running', async () => {
    let releaseFirstCheck: () => void = () => undefined;
    const findViolations = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFirstCheck = () => resolve([]);
        }),
    );
    registry.register({
      name: 'slow',
      title: 'x',
      source: 'mls',
      findViolations,
    });

    const first = service.runChecks();
    const second = service.runChecks();
    releaseFirstCheck();
    await Promise.all([first, second]);

    expect(findViolations).toHaveBeenCalledTimes(1);
  });
});
