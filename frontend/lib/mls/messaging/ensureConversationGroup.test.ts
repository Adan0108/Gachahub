import { describe, expect, it, vi } from 'vitest';
import { ensureConversationGroup } from './ensureConversationGroup';
import { EpochConflictError, GroupStateUnavailableError } from '../contract/errors';

function fakeSyncEngine() {
  return {
    getCurrentEpoch: vi.fn(),
    createGroup: vi.fn(),
    seedNewGroupWithMembers: vi.fn(),
    forgetConversation: vi.fn(),
  };
}

describe('ensureConversationGroup', () => {
  it('does nothing when a local group already exists', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(3);

    await ensureConversationGroup(engine as any, 'conv-1', 'user-bob');

    expect(engine.createGroup).not.toHaveBeenCalled();
    expect(engine.seedNewGroupWithMembers).not.toHaveBeenCalled();
  });

  it('creates a group and adds a single recipient when none exists yet', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockRejectedValue(new GroupStateUnavailableError('conv-1'));

    await ensureConversationGroup(engine as any, 'conv-1', 'user-bob');

    expect(engine.createGroup).toHaveBeenCalledWith('conv-1');
    expect(engine.seedNewGroupWithMembers).toHaveBeenCalledWith('conv-1', ['user-bob']);
  });

  it('creates a group and adds every founding member when given an array', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockRejectedValue(new GroupStateUnavailableError('conv-1'));

    await ensureConversationGroup(engine as any, 'conv-1', ['user-bob', 'user-carol']);

    expect(engine.createGroup).toHaveBeenCalledWith('conv-1');
    expect(engine.seedNewGroupWithMembers).toHaveBeenCalledWith('conv-1', [
      'user-bob',
      'user-carol',
    ]);
  });

  it('propagates an unrelated error without attempting to create a group', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockRejectedValue(new Error('network down'));

    await expect(ensureConversationGroup(engine as any, 'conv-1', 'user-bob')).rejects.toThrow(
      'network down',
    );
    expect(engine.createGroup).not.toHaveBeenCalled();
  });

  it('propagates a failure from seedNewGroupWithMembers (e.g. recipient not yet active)', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockRejectedValue(new GroupStateUnavailableError('conv-1'));
    engine.createGroup.mockResolvedValue(undefined);
    engine.seedNewGroupWithMembers.mockRejectedValue(
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
    engine.seedNewGroupWithMembers.mockRejectedValue(new Error('not an active participant'));

    await expect(ensureConversationGroup(engine as any, 'conv-1', 'user-bob')).rejects.toThrow();

    expect(engine.forgetConversation).toHaveBeenCalledWith('conv-1');
  });

  // regression: an EpochConflictError means SyncEngine.submitMembershipChange
  // already caught local state up to the winning commit and persisted it
  // before throwing - forgetting the conversation here used to discard that
  // valid state, forcing every retry to recreate a fresh epoch-0 local group
  // that the server (already past epoch 0) rejects the exact same way,
  // forever. Once triggered, sending to that conversation could never
  // recover on its own.
  it('does not forget the conversation on an epoch conflict, since local state is already caught up', async () => {
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockRejectedValue(new GroupStateUnavailableError('conv-1'));
    engine.createGroup.mockResolvedValue(undefined);
    engine.seedNewGroupWithMembers.mockRejectedValue(new EpochConflictError('conv-1', 0));

    await expect(ensureConversationGroup(engine as any, 'conv-1', 'user-bob')).rejects.toThrow(
      EpochConflictError,
    );

    expect(engine.forgetConversation).not.toHaveBeenCalled();
  });
});
