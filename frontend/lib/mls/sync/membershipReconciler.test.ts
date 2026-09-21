import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EpochConflictError, GroupStateUnavailableError } from '../contract/errors';
import { bytesToBase64 } from '../storage/base64';
import { MembershipReconciler, type MembershipWorkItem } from './membershipReconciler';

vi.mock('../../api', () => ({
  api: {
    getMlsMembershipWork: vi.fn(),
    claimChatDeviceKeyPackages: vi.fn(),
  },
}));

const claimed = (deviceId: string) => ({
  deviceId,
  signaturePublicKey: bytesToBase64(new Uint8Array([1])),
  payload: bytesToBase64(new Uint8Array([2])),
});

const item = (overrides: Partial<MembershipWorkItem> = {}): MembershipWorkItem => ({
  conversationId: 'conv-1',
  epoch: 4,
  add: [],
  remove: [],
  unreachableUserIds: [],
  ...overrides,
});

function fakeEngine() {
  return {
    syncCommits: vi.fn().mockResolvedValue(4),
    submitMembershipChange: vi.fn().mockResolvedValue(5),
  };
}

async function load() {
  const { api } = await import('../../api');
  return api;
}

/** Answers the work endpoint with these pages in order, then an empty page forever. */
async function serveWork(
  ...pages: Array<{ items: MembershipWorkItem[]; nextCursor?: string | null }>
) {
  const api = await load();
  const mock = vi.mocked(api.getMlsMembershipWork);
  mock.mockReset();
  for (const page of pages) {
    mock.mockResolvedValueOnce({ items: page.items, nextCursor: page.nextCursor ?? null });
  }
  mock.mockResolvedValue({ items: [], nextCursor: null });
  return mock;
}

describe('MembershipReconciler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = await load();
    vi.mocked(api.claimChatDeviceKeyPackages).mockReset();
  });

  it('does nothing when the server has no work for this device', async () => {
    const work = await serveWork({ items: [] });
    const engine = fakeEngine();

    const summary = await new MembershipReconciler(engine, 'dev-1').reconcile();

    expect(summary.outcomes).toEqual([]);
    expect(work).toHaveBeenCalledWith('dev-1', { after: undefined, conversationId: undefined });
    expect(engine.syncCommits).not.toHaveBeenCalled();
  });

  it('adds someone waiting to join: catches up, claims their devices, submits one Commit', async () => {
    await serveWork({
      items: [item({ add: [{ userId: 'u2', deviceId: 'd2' }] })],
    });
    const api = await load();
    vi.mocked(api.claimChatDeviceKeyPackages).mockResolvedValue([claimed('d2'), claimed('d2b')]);
    const engine = fakeEngine();

    const summary = await new MembershipReconciler(engine, 'dev-1').reconcile();

    expect(engine.syncCommits).toHaveBeenCalledWith('conv-1');
    expect(api.claimChatDeviceKeyPackages).toHaveBeenCalledWith('u2');
    const [conversationId, change] = engine.submitMembershipChange.mock.calls[0]!;
    expect(conversationId).toBe('conv-1');
    expect(
      change.added.map((o: { credential: { userId: string; deviceId: string } }) => o.credential),
    ).toEqual([
      expect.objectContaining({ userId: 'u2', deviceId: 'd2' }),
      expect.objectContaining({ userId: 'u2', deviceId: 'd2b' }),
    ]);
    expect(change.removed).toEqual([]);
    expect(summary.outcomes).toEqual([{ conversationId: 'conv-1', outcome: 'committed' }]);
  });

  it('removes someone leaving without claiming anything', async () => {
    await serveWork({
      items: [item({ remove: [{ userId: 'u3', deviceId: 'd3' }] })],
    });
    const api = await load();
    const engine = fakeEngine();

    await new MembershipReconciler(engine, 'dev-1').reconcile();

    expect(api.claimChatDeviceKeyPackages).not.toHaveBeenCalled();
    expect(engine.submitMembershipChange).toHaveBeenCalledWith('conv-1', {
      added: [],
      removed: [{ userId: 'u3', deviceId: 'd3' }],
    });
  });

  it('adds and removes in the same Commit', async () => {
    await serveWork({
      items: [
        item({
          add: [{ userId: 'u2', deviceId: 'd2' }],
          remove: [{ userId: 'u3', deviceId: 'd3' }],
        }),
      ],
    });
    const api = await load();
    vi.mocked(api.claimChatDeviceKeyPackages).mockResolvedValue([claimed('d2')]);
    const engine = fakeEngine();

    await new MembershipReconciler(engine, 'dev-1').reconcile();

    expect(engine.submitMembershipChange).toHaveBeenCalledTimes(1);
    const [, change] = engine.submitMembershipChange.mock.calls[0]!;
    expect(change.added).toHaveLength(1);
    expect(change.removed).toEqual([{ userId: 'u3', deviceId: 'd3' }]);
  });

  describe('when the work is out of date', () => {
    it('does not claim key packages if the group is not at the epoch the work was computed for', async () => {
      await serveWork({ items: [item({ add: [{ userId: 'u2', deviceId: 'd2' }] })] });
      const api = await load();
      const engine = fakeEngine();
      engine.syncCommits.mockResolvedValue(6);

      const summary = await new MembershipReconciler(engine, 'dev-1').reconcile();

      expect(api.claimChatDeviceKeyPackages).not.toHaveBeenCalled();
      expect(engine.submitMembershipChange).not.toHaveBeenCalled();
      expect(summary.outcomes[0]?.outcome).toBe('stale');
    });

    it('skips a conversation this device has no local copy of', async () => {
      await serveWork({ items: [item({ add: [{ userId: 'u2', deviceId: 'd2' }] })] });
      const api = await load();
      const engine = fakeEngine();
      engine.syncCommits.mockRejectedValue(new GroupStateUnavailableError('conv-1'));

      const summary = await new MembershipReconciler(engine, 'dev-1').reconcile();

      expect(api.claimChatDeviceKeyPackages).not.toHaveBeenCalled();
      expect(summary.outcomes[0]?.outcome).toBe('no-local-state');
    });
  });

  describe('claiming key packages', () => {
    it('still adds the people it could claim for when one user cannot be claimed', async () => {
      await serveWork({
        items: [
          item({
            add: [
              { userId: 'u2', deviceId: 'd2' },
              { userId: 'u3', deviceId: 'd3' },
            ],
          }),
        ],
      });
      const api = await load();
      vi.mocked(api.claimChatDeviceKeyPackages).mockImplementation(async (userId: string) => {
        if (userId === 'u2') throw new Error('no devices');
        return [claimed('d3')];
      });
      const engine = fakeEngine();

      await new MembershipReconciler(engine, 'dev-1').reconcile();

      const [, change] = engine.submitMembershipChange.mock.calls[0]!;
      expect(change.added).toHaveLength(1);
      expect(change.added[0].credential.userId).toBe('u3');
    });

    it('commits nothing when nobody could be claimed and nothing is being removed', async () => {
      await serveWork({ items: [item({ add: [{ userId: 'u2', deviceId: 'd2' }] })] });
      const api = await load();
      vi.mocked(api.claimChatDeviceKeyPackages).mockResolvedValue([]);
      const engine = fakeEngine();

      const summary = await new MembershipReconciler(engine, 'dev-1').reconcile();

      expect(engine.submitMembershipChange).not.toHaveBeenCalled();
      expect(summary.outcomes[0]?.outcome).toBe('nothing-to-do');
    });

    it('claims once per user, however many of their devices are listed', async () => {
      await serveWork({
        items: [
          item({
            add: [
              { userId: 'u2', deviceId: 'd2a' },
              { userId: 'u2', deviceId: 'd2b' },
            ],
          }),
        ],
      });
      const api = await load();
      vi.mocked(api.claimChatDeviceKeyPackages).mockResolvedValue([claimed('d2a'), claimed('d2b')]);

      await new MembershipReconciler(fakeEngine(), 'dev-1').reconcile();

      expect(api.claimChatDeviceKeyPackages).toHaveBeenCalledTimes(1);
    });

    it('stops before a user whose devices would push the Commit past the server limit', async () => {
      await serveWork({
        items: [
          item({
            add: [
              { userId: 'u2', deviceId: 'x' },
              { userId: 'u3', deviceId: 'y' },
            ],
          }),
        ],
      });
      const api = await load();
      const many = (prefix: string, n: number) =>
        Array.from({ length: n }, (_, i) => claimed(`${prefix}${i}`));
      vi.mocked(api.claimChatDeviceKeyPackages).mockImplementation(async (userId: string) =>
        userId === 'u2' ? many('a', 30) : many('b', 30),
      );
      const engine = fakeEngine();

      await new MembershipReconciler(engine, 'dev-1').reconcile();

      const [, change] = engine.submitMembershipChange.mock.calls[0]!;
      expect(change.added).toHaveLength(30);
    });
  });

  describe('racing another member', () => {
    it('recomputes after losing the epoch race, and stops once there is nothing left', async () => {
      const work = await serveWork(
        { items: [item({ remove: [{ userId: 'u3', deviceId: 'd3' }] })] },
        { items: [] },
      );
      const engine = fakeEngine();
      engine.submitMembershipChange.mockRejectedValueOnce(new EpochConflictError('conv-1', 4));

      const summary = await new MembershipReconciler(engine, 'dev-1').reconcile();

      expect(summary.outcomes).toEqual([{ conversationId: 'conv-1', outcome: 'conflict' }]);
      expect(work).toHaveBeenCalledTimes(2);
    });

    it('gives up after a few passes instead of looping forever', async () => {
      const api = await load();
      const work = vi.mocked(api.getMlsMembershipWork);
      work.mockReset();
      work.mockResolvedValue({
        items: [item({ remove: [{ userId: 'u3', deviceId: 'd3' }] })],
        nextCursor: null,
      });
      const engine = fakeEngine();
      engine.submitMembershipChange.mockRejectedValue(new EpochConflictError('conv-1', 4));

      const summary = await new MembershipReconciler(engine, 'dev-1').reconcile();

      expect(summary.outcomes).toHaveLength(3);
      expect(work).toHaveBeenCalledTimes(3);
    });
  });

  it('carries on with the other conversations when one fails', async () => {
    await serveWork({
      items: [
        item({ conversationId: 'conv-a', remove: [{ userId: 'u3', deviceId: 'd3' }] }),
        item({ conversationId: 'conv-b', remove: [{ userId: 'u4', deviceId: 'd4' }] }),
      ],
    });
    const engine = fakeEngine();
    engine.submitMembershipChange
      .mockRejectedValueOnce(new Error('server said no'))
      .mockResolvedValueOnce(5);

    const summary = await new MembershipReconciler(engine, 'dev-1').reconcile();

    expect(summary.outcomes).toEqual([
      { conversationId: 'conv-a', outcome: 'failed' },
      { conversationId: 'conv-b', outcome: 'committed' },
    ]);
  });

  describe('fetching work', () => {
    it('follows the cursor until the server has no more pages', async () => {
      const work = await serveWork(
        {
          items: [item({ conversationId: 'conv-a', remove: [{ userId: 'u3', deviceId: 'd3' }] })],
          nextCursor: 'conv-a',
        },
        { items: [item({ conversationId: 'conv-b', remove: [{ userId: 'u4', deviceId: 'd4' }] })] },
      );
      const engine = fakeEngine();

      const summary = await new MembershipReconciler(engine, 'dev-1').reconcile();

      expect(work).toHaveBeenNthCalledWith(1, 'dev-1', {
        after: undefined,
        conversationId: undefined,
      });
      expect(work).toHaveBeenNthCalledWith(2, 'dev-1', {
        after: 'conv-a',
        conversationId: undefined,
      });
      expect(summary.outcomes.map((o) => o.conversationId)).toEqual(['conv-a', 'conv-b']);
    });

    it('stops paging if the server hands back the same cursor twice', async () => {
      const api = await load();
      const work = vi.mocked(api.getMlsMembershipWork);
      work.mockReset();
      work.mockResolvedValue({ items: [], nextCursor: 'stuck' });

      await new MembershipReconciler(fakeEngine(), 'dev-1').reconcile();

      expect(work).toHaveBeenCalledTimes(2);
    });

    it('can be limited to one conversation', async () => {
      const work = await serveWork({ items: [] });

      await new MembershipReconciler(fakeEngine(), 'dev-1').reconcile({ conversationId: 'conv-9' });

      expect(work).toHaveBeenCalledWith('dev-1', { after: undefined, conversationId: 'conv-9' });
    });
  });
});
