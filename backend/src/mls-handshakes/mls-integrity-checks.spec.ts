jest.mock('./mls-audit.repository', () => ({ MlsAuditRepository: class {} }));

import { IntegrityCheckRegistry } from '../common/integrity/integrity-check.registry';
import { MlsIntegrityChecks } from './mls-integrity-checks';

describe('MlsIntegrityChecks', () => {
  const repository = {
    findLeavesOfDeadDevices: jest.fn().mockResolvedValue([]),
    findLeavesOfOutsiders: jest.fn().mockResolvedValue([]),
    findStuckParticipants: jest.fn().mockResolvedValue([]),
  };

  let registry: IntegrityCheckRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new IntegrityCheckRegistry();
    new MlsIntegrityChecks(registry, repository as never).onModuleInit();
  });

  const check = (name: string) => {
    const found = registry.list().find((entry) => entry.name === name);
    if (!found) throw new Error(`check ${name} not registered`);
    return found;
  };

  it('registers the three MLS invariants', () => {
    expect(registry.list().map((entry) => entry.name)).toEqual([
      'mls-dead-device-leaf',
      'mls-outsider-leaf',
      'mls-stuck-membership',
    ]);
  });

  it('describes a device sitting in a group its owner is not in', async () => {
    repository.findLeavesOfOutsiders.mockResolvedValue([
      { conversationId: 'conv-1', userId: 'intruder', deviceId: 'd1' },
    ]);

    await expect(check('mls-outsider-leaf').findViolations()).resolves.toEqual([
      'conv-1 / intruder / d1',
    ]);
  });

  it('describes a join or removal stuck past its window', async () => {
    repository.findStuckParticipants.mockResolvedValue([
      { conversationId: 'conv-2', userId: 'u2', state: 'LEAVING' },
    ]);

    await expect(
      check('mls-stuck-membership').findViolations(),
    ).resolves.toEqual(['conv-2 / u2 (LEAVING)']);
  });
});
