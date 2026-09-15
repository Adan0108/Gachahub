import { describe, expect, it, vi } from 'vitest';
import { ensureConversationGroup } from './ensureConversationGroup';
import { GroupStateUnavailableError } from './errors';

function fakeSyncEngine() {
  return {
    getCurrentEpoch: vi.fn(),
    createGroup: vi.fn(),
    addUserToConversation: vi.fn(),
    forgetConversation: vi.fn(),
  };
}

describe('ensureConversationGroup', () => {
  it('does nothing when a local group already exists', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(3);

    await ensureConversationGroup(engine as any, 'conv-1', 'user-bob');

    expect(engine.createGroup).not.toHaveBeenCalled();
    expect(engine.addUserToConversation).not.toHaveBeenCalled();
  });

  it('creates a group and adds the recipient when none exists yet', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockRejectedValue(new GroupStateUnavailableError('conv-1'));

    await ensureConversationGroup(engine as any, 'conv-1', 'user-bob');

    expect(engine.createGroup).toHaveBeenCalledWith('conv-1');
    expect(engine.addUserToConversation).toHaveBeenCalledWith('conv-1', 'user-bob');
  });

  it('propagates an unrelated error without attempting to create a group', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockRejectedValue(new Error('network down'));

    await expect(ensureConversationGroup(engine as any, 'conv-1', 'user-bob')).rejects.toThrow(
      'network down',
    );
    expect(engine.createGroup).not.toHaveBeenCalled();
  });

  it('propagates a failure from addUserToConversation (e.g. recipient not yet active)', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockRejectedValue(new GroupStateUnavailableError('conv-1'));
    engine.createGroup.mockResolvedValue(undefined);
    engine.addUserToConversation.mockRejectedValue(
      new Error('User user-bob is not an active participant of this conversation'),
    );

    await expect(ensureConversationGroup(engine as any, 'conv-1', 'user-bob')).rejects.toThrow(
      'not an active participant',
    );
  });

  it('drops the half-created local group when adding the recipient fails, so a retry starts clean', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockRejectedValue(new GroupStateUnavailableError('conv-1'));
    engine.createGroup.mockResolvedValue(undefined);
    engine.addUserToConversation.mockRejectedValue(new Error('not an active participant'));

    await expect(ensureConversationGroup(engine as any, 'conv-1', 'user-bob')).rejects.toThrow();

    expect(engine.forgetConversation).toHaveBeenCalledWith('conv-1');
  });
});
