import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from './syncEngine';
import { InMemoryGroupSessionStorage } from '../storage/groupSessionStorage';
import type { GroupSessionStorage } from '../storage/groupSessionStorage';
import {
  MlsWipedError,
  UnreadableRecordError,
  wipeAllLocalMlsSecrets,
  wipeGroupSessionState,
} from '../storage/mlsEncryptedStore';
import { bytesToBase64 } from '../storage/base64';
import {
  GroupStateCorruptedError,
  GroupStateUnavailableError,
  MembershipMismatchError,
  StaleWelcomeError,
} from '../contract/errors';
import type { GroupSession, GroupSessionFactory } from '../contract/client';
import type { KeyPackageSupply } from '../device/keyPackageReplenisher';

vi.mock('../../api', () => ({
  api: {
    getMlsHandshakesSince: vi.fn(),
    getMlsPendingWelcomes: vi.fn(),
    consumeMlsWelcome: vi.fn(),
    reportMlsFault: vi.fn(),
    getMlsRoster: vi.fn(),
    getMlsGroupInfo: vi.fn(),
    submitMlsExternalJoin: vi.fn(),
    getMlsJoinableConversations: vi.fn(),
  },
}));

/** A session whose whole state is its epoch (serialized as one byte); every processed item advances it. */
class FakeSession {
  constructor(
    public epoch: number,
    private readonly failProcess = false,
  ) {}
  currentEpoch = async () => this.epoch;
  serialize = async () => new Uint8Array([this.epoch]);
  listLeaves = async () => [];
  process = async () => {
    if (this.failProcess) throw new Error('bad commit');
    this.epoch += 1;
    return { kind: 'other' };
  };
}

const asSession = (session: FakeSession) => session as unknown as GroupSession;

class FakeFactory {
  keyPackageSpent = false;
  crashAfterSave = false;
  failNextProcess = false;
  joinExternally = vi.fn();

  restore = async (_id: string, bytes: Uint8Array) =>
    asSession(new FakeSession(bytes[0]!, this.failNextProcess));

  /** Mirrors the real adapter: verify, then onAccepted, only then spend the key package. */
  joinFromWelcome: GroupSessionFactory['joinFromWelcome'] = async (_id, _bytes, options) => {
    const session = asSession(new FakeSession(1));
    try {
      await options?.verify?.(session);
    } catch (error) {
      if (error instanceof StaleWelcomeError || error instanceof MembershipMismatchError) {
        this.keyPackageSpent = true;
      }
      throw error;
    }
    await options?.onAccepted?.(session);
    if (this.crashAfterSave) throw new Error('crash before the key package was spent');
    this.keyPackageSpent = true;
    return session;
  };
}

const welcome = (id: string, conversationId = 'conv-1') => ({
  id,
  conversationId,
  payload: bytesToBase64(new Uint8Array([1])),
});

function setUp(options: { storage?: GroupSessionStorage; supply?: KeyPackageSupply } = {}) {
  const factory = new FakeFactory();
  const storage = options.storage ?? new InMemoryGroupSessionStorage();
  const engine = new SyncEngine(
    factory as unknown as GroupSessionFactory,
    'device-1',
    'user-1',
    storage,
    options.supply,
  );
  return { factory, storage, engine };
}

async function mocks() {
  const { api } = await import('../../api');
  vi.mocked(api.getMlsRoster).mockResolvedValue({ epoch: 1, leaves: [] } as never);
  vi.mocked(api.consumeMlsWelcome).mockResolvedValue(undefined as never);
  vi.mocked(api.reportMlsFault).mockResolvedValue({ recorded: true } as never);
  return api;
}

describe('SyncEngine resilience', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('a Welcome interrupted part way', () => {
    it('saves the group before spending the key package, so a crash between them keeps the join', async () => {
      const api = await mocks();
      const { engine, factory, storage } = setUp();
      factory.crashAfterSave = true;
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([welcome('w-1')] as never);

      const first = await engine.processPendingWelcomes();

      expect(first.failures).toHaveLength(1);
      expect(await storage.load('conv-1')).toBeDefined();
      expect(factory.keyPackageSpent).toBe(false);
      expect(api.consumeMlsWelcome).not.toHaveBeenCalled();

      // the rerun finds the saved group at the same epoch: nothing to join, just consume it
      factory.crashAfterSave = false;
      const second = await engine.processPendingWelcomes();

      expect(second.joined).toEqual([]);
      expect(second.failures).toEqual([]);
      expect(api.consumeMlsWelcome).toHaveBeenCalledTimes(1);
      expect(api.consumeMlsWelcome).toHaveBeenCalledWith('device-1', 'w-1');
      expect(factory.keyPackageSpent).toBe(true);
      await expect(engine.getCurrentEpoch('conv-1')).resolves.toBe(1);
    });

    it('keeps the key package when saving the group fails', async () => {
      const api = await mocks();
      const storage = new InMemoryGroupSessionStorage();
      vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('disk full'));
      const { engine, factory } = setUp({ storage });
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([welcome('w-1')] as never);

      const result = await engine.processPendingWelcomes();

      expect(result.failures).toHaveLength(1);
      expect(factory.keyPackageSpent).toBe(false);
      expect(api.consumeMlsWelcome).not.toHaveBeenCalled();
    });

    it('tops up key packages after a Welcome was joined', async () => {
      const api = await mocks();
      const supply = { maybeReplenish: vi.fn().mockResolvedValue(undefined) };
      const { engine } = setUp({ supply });
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([welcome('w-1')] as never);

      await engine.processPendingWelcomes();

      expect(supply.maybeReplenish).toHaveBeenCalledWith({ force: true });
    });
  });

  describe('paged responses', () => {
    it('keeps fetching Welcomes while the server says there are more, following its cursor', async () => {
      const api = await mocks();
      const { engine } = setUp();
      vi.mocked(api.getMlsPendingWelcomes)
        .mockResolvedValueOnce({ welcomes: [welcome('w-1', 'a')], hasMore: true, nextCursor: 'c1' } as never)
        .mockResolvedValueOnce({ welcomes: [welcome('w-2', 'b')], hasMore: false } as never);

      const result = await engine.processPendingWelcomes();

      expect(result.joined).toEqual(['a', 'b']);
      expect(api.getMlsPendingWelcomes).toHaveBeenNthCalledWith(2, 'device-1', { after: 'c1' });
    });

    it('stops when a page brings nothing new even if it claims there is more', async () => {
      const api = await mocks();
      const { engine, factory } = setUp();
      factory.crashAfterSave = true;
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue({
        welcomes: [welcome('w-1')],
        hasMore: true,
      } as never);

      await engine.processPendingWelcomes();

      expect(api.getMlsPendingWelcomes).toHaveBeenCalledTimes(2);
    });

    it('keeps fetching commits from the epoch the last page reached while hasMore is set', async () => {
      const api = await mocks();
      const { engine, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([0]));
      const handshake = (epoch: number) => ({ epoch, payload: bytesToBase64(new Uint8Array([epoch])) });
      vi.mocked(api.getMlsHandshakesSince)
        .mockResolvedValueOnce({ items: [handshake(0), handshake(1)], hasMore: true } as never)
        .mockResolvedValueOnce({ items: [handshake(2)], hasMore: false } as never);

      await expect(engine.syncCommits('conv-1')).resolves.toBe(3);

      expect(api.getMlsHandshakesSince).toHaveBeenNthCalledWith(1, 'conv-1', 0);
      expect(api.getMlsHandshakesSince).toHaveBeenNthCalledWith(2, 'conv-1', 2);
    });

    it('does not loop on a hasMore page that moves nothing', async () => {
      const api = await mocks();
      const { engine, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([0]));
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue({ items: [], hasMore: true } as never);

      await engine.syncCommits('conv-1');

      expect(api.getMlsHandshakesSince).toHaveBeenCalledTimes(1);
    });
  });

  describe('group problems', () => {
    it('records a refused commit, and clears it once a later sync succeeds', async () => {
      const api = await mocks();
      const { engine, storage, factory } = setUp();
      await storage.save('conv-1', new Uint8Array([0]));
      factory.failNextProcess = true;
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([
        { epoch: 0, payload: bytesToBase64(new Uint8Array([9])) },
      ] as never);

      await expect(engine.syncCommits('conv-1')).rejects.toThrow(MembershipMismatchError);
      expect(engine.groupProblems.get('conv-1')).toEqual({ kind: 'refused-commit' });

      // a refused group is never "recovered" by rejoining
      await expect(engine.recoverMissingGroup('conv-1')).resolves.toBe(false);
      expect(factory.joinExternally).not.toHaveBeenCalled();

      factory.failNextProcess = false;
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([] as never);
      await engine.syncCommits('conv-1');
      expect(engine.groupProblems.get('conv-1')).toBeUndefined();
    });

    it('notifies subscribers when the problem changes', async () => {
      const { engine } = setUp();
      const listener = vi.fn();
      engine.groupProblems.subscribe(listener);

      engine.groupProblems.mark('conv-1', 'refused-commit');
      engine.groupProblems.mark('conv-1', 'refused-commit');
      engine.groupProblems.clear('conv-1');

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('treats unreadable saved state as a problem and never rejoins over it', async () => {
      await mocks();
      const storage = new InMemoryGroupSessionStorage();
      vi.spyOn(storage, 'load').mockRejectedValue(new UnreadableRecordError('groupSessions', 'conv-1'));
      const { engine, factory } = setUp({ storage });

      await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);
      expect(engine.groupProblems.get('conv-1')).toEqual({ kind: 'state-unreadable' });

      await expect(engine.joinByExternalCommit('conv-1')).rejects.toBeInstanceOf(
        GroupStateCorruptedError,
      );
      await expect(engine.recoverMissingGroup('conv-1')).resolves.toBe(false);
      expect(factory.joinExternally).not.toHaveBeenCalled();
    });

    describe('repairing unreadable saved state', () => {
      /** Reads of conv-1 fail until the copy is wiped (or set right again); everything else behaves normally. */
      const breakStorage = (storage: InMemoryGroupSessionStorage) => {
        const state = { broken: true };
        const realLoad = storage.load.bind(storage);
        const realDelete = storage.delete.bind(storage);
        vi.spyOn(storage, 'load').mockImplementation(async (id) => {
          if (state.broken && id === 'conv-1') throw new UnreadableRecordError('groupSessions', 'conv-1');
          return realLoad(id);
        });
        vi.spyOn(storage, 'delete').mockImplementation(async (id) => {
          if (id === 'conv-1') state.broken = false;
          await realDelete(id);
        });
        return state;
      };

      it('wipes the unreadable copy and self-joins once, then clears the problem', async () => {
        const api = await mocks();
        const storage = new InMemoryGroupSessionStorage();
        breakStorage(storage);
        const { engine, factory } = setUp({ storage });
        vi.mocked(api.getMlsGroupInfo).mockResolvedValue({ epoch: 1, groupInfo: 'AA==' } as never);
        vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'accepted' } as never);
        factory.joinExternally.mockResolvedValue({
          session: asSession(new FakeSession(2)),
          commitBytes: new Uint8Array([1]),
          groupInfoBytes: new Uint8Array([2]),
        });
        await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);

        await expect(engine.recoverUnreadableGroup('conv-1')).resolves.toBe(true);

        expect(factory.joinExternally).toHaveBeenCalledTimes(1);
        expect(engine.groupProblems.get('conv-1')).toBeUndefined();
      });

      it('tries only once per cooldown window', async () => {
        const api = await mocks();
        const storage = new InMemoryGroupSessionStorage();
        const state = breakStorage(storage);
        const { engine, factory } = setUp({ storage });
        vi.mocked(api.getMlsGroupInfo).mockResolvedValue({ epoch: 1, groupInfo: 'AA==' } as never);
        factory.joinExternally.mockRejectedValue(new Error('no snapshot'));
        await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);

        await expect(engine.recoverUnreadableGroup('conv-1')).resolves.toBe(false);
        state.broken = true;
        engine.groupProblems.mark('conv-1', 'state-unreadable');
        await expect(engine.recoverUnreadableGroup('conv-1')).resolves.toBe(false);

        expect(factory.joinExternally).toHaveBeenCalledTimes(1);
      });

      it('leaves the saved copy alone when it turns out to be readable again', async () => {
        await mocks();
        const storage = new InMemoryGroupSessionStorage();
        const realLoad = storage.load.bind(storage);
        let reads = 0;
        const load = vi.spyOn(storage, 'load').mockImplementation(async (id) => {
          if (id !== 'conv-1') return realLoad(id);
          reads += 1;
          if (reads === 1) throw new UnreadableRecordError('groupSessions', 'conv-1');
          return new Uint8Array([1]);
        });
        const remove = vi.spyOn(storage, 'delete');
        const { engine, factory } = setUp({ storage });
        await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);

        await expect(engine.recoverUnreadableGroup('conv-1')).resolves.toBe(true);

        expect(reads).toBe(2);
        expect(load).toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(factory.joinExternally).not.toHaveBeenCalled();
        expect(engine.groupProblems.get('conv-1')).toBeUndefined();
      });

      it('does nothing for a group that is not flagged unreadable', async () => {
        const { engine, factory } = setUp();

        await expect(engine.recoverUnreadableGroup('conv-1')).resolves.toBe(false);

        expect(factory.joinExternally).not.toHaveBeenCalled();
      });
    });

    it('makes one bounded self-join try for a missing group, then flags it', async () => {
      const api = await mocks();
      const { engine, factory } = setUp();
      vi.mocked(api.getMlsGroupInfo).mockResolvedValue({ epoch: 1, groupInfo: 'AA==' } as never);
      factory.joinExternally.mockRejectedValue(new Error('no snapshot'));
      await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateUnavailableError);

      await expect(engine.recoverMissingGroup('conv-1')).resolves.toBe(false);
      await expect(engine.recoverMissingGroup('conv-1')).resolves.toBe(false);

      expect(factory.joinExternally).toHaveBeenCalledTimes(1);
      expect(engine.groupProblems.get('conv-1')).toEqual({ kind: 'state-unavailable' });
    });

    it('clears the flag when the self-join works', async () => {
      const api = await mocks();
      const { engine, factory } = setUp();
      engine.groupProblems.mark('conv-1', 'state-unavailable');
      vi.mocked(api.getMlsGroupInfo).mockResolvedValue({ epoch: 1, groupInfo: 'AA==' } as never);
      vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'accepted' } as never);
      factory.joinExternally.mockResolvedValue({
        session: asSession(new FakeSession(2)),
        commitBytes: new Uint8Array([1]),
        groupInfoBytes: new Uint8Array([2]),
      });

      await expect(engine.recoverMissingGroup('conv-1')).resolves.toBe(true);

      expect(engine.groupProblems.get('conv-1')).toBeUndefined();
    });
  });

  describe('a failure part way through catching up', () => {
    const declared = (epoch: number) => ({
      epoch,
      payload: bytesToBase64(new Uint8Array([epoch])),
      membershipDeclared: true,
    });

    it('drops the unverified session on any error, so the next sync re-verifies from the last verified epoch', async () => {
      const api = await mocks();
      const { engine, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([0]));
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([declared(0)] as never);
      vi.mocked(api.getMlsRoster).mockRejectedValueOnce(new Error('network down'));

      await expect(engine.syncCommits('conv-1')).rejects.toThrow('network down');

      // not a refused commit: nothing was found wrong, so the group is not flagged
      expect(engine.groupProblems.get('conv-1')).toBeUndefined();
      expect(await storage.load('conv-1')).toEqual(new Uint8Array([0]));

      await expect(engine.syncCommits('conv-1')).resolves.toBe(1);
      expect(api.getMlsHandshakesSince).toHaveBeenNthCalledWith(2, 'conv-1', 0);
      expect(await storage.load('conv-1')).toEqual(new Uint8Array([1]));
    });

    it('does not save the advanced epoch when the roster check fails', async () => {
      const api = await mocks();
      const { engine, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([0]));
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([declared(0)] as never);
      vi.mocked(api.getMlsRoster).mockRejectedValue(new Error('network down'));

      await expect(engine.syncCommits('conv-1')).rejects.toThrow();
      await expect(engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'x' })).rejects.toThrow();

      expect(await storage.load('conv-1')).toEqual(new Uint8Array([0]));
    });
  });

  describe('a group whose saved state exists but will not restore', () => {
    it('is never treated as missing: nothing joins over it, and it is flagged unreadable', async () => {
      await mocks();
      const { engine, factory, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([7]));
      factory.restore = async () => {
        throw new Error('bad bytes');
      };

      await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);
      expect(engine.groupProblems.get('conv-1')).toEqual({ kind: 'state-unreadable' });

      await expect(engine.joinByExternalCommit('conv-1')).rejects.toBeInstanceOf(
        GroupStateCorruptedError,
      );
      await expect(engine.recoverMissingGroup('conv-1')).resolves.toBe(false);
      expect(factory.joinExternally).not.toHaveBeenCalled();
      expect(await storage.load('conv-1')).toEqual(new Uint8Array([7]));
    });

    it('is replaced only by the explicit repair, which wipes it and rejoins', async () => {
      const api = await mocks();
      const { engine, factory, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([7]));
      factory.restore = async () => {
        throw new Error('bad bytes');
      };
      vi.mocked(api.getMlsGroupInfo).mockResolvedValue({ epoch: 1, groupInfo: 'AA==' } as never);
      vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'accepted' } as never);
      factory.joinExternally.mockResolvedValue({
        session: asSession(new FakeSession(2)),
        commitBytes: new Uint8Array([1]),
        groupInfoBytes: new Uint8Array([2]),
      });
      await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);

      await expect(engine.recoverUnreadableGroup('conv-1')).resolves.toBe(true);

      expect(factory.joinExternally).toHaveBeenCalledTimes(1);
      expect(await storage.load('conv-1')).toEqual(new Uint8Array([2]));
    });
  });

  describe('a Welcome that is refused', () => {
    it('flags the group as refused, so the banner shows', async () => {
      const api = await mocks();
      vi.mocked(api.getMlsRoster).mockResolvedValue({
        epoch: 1,
        leaves: [{ deviceId: 'someone', userId: 'u', signaturePublicKey: null }],
      } as never);
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([welcome('w-1')] as never);
      const { engine } = setUp();

      const result = await engine.processPendingWelcomes();

      expect(result.failures[0]?.error).toBeInstanceOf(MembershipMismatchError);
      expect(engine.groupProblems.get('conv-1')).toEqual({ kind: 'refused-commit' });
      expect(api.consumeMlsWelcome).toHaveBeenCalledWith('device-1', 'w-1');
    });
  });

  describe('a Welcome whose group fails to save', () => {
    it('leaves nothing cached, so the retry joins it again instead of treating it as stale', async () => {
      const api = await mocks();
      const storage = new InMemoryGroupSessionStorage();
      vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('disk full'));
      const { engine } = setUp({ storage });
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([welcome('w-1')] as never);

      const first = await engine.processPendingWelcomes();
      expect(first.failures).toHaveLength(1);
      expect(api.consumeMlsWelcome).not.toHaveBeenCalled();

      const second = await engine.processPendingWelcomes();

      expect(second.joined).toEqual(['conv-1']);
      expect(await storage.load('conv-1')).toEqual(new Uint8Array([1]));
    });
  });

  describe('recovery cooldown', () => {
    /** Reads of conv-1 fail until it is deleted; deletes can be made to fail. */
    function unreadableStorage() {
      const storage = new InMemoryGroupSessionStorage();
      const state = { broken: true, deleteFails: false };
      const realLoad = storage.load.bind(storage);
      const realDelete = storage.delete.bind(storage);
      vi.spyOn(storage, 'load').mockImplementation(async (id) => {
        if (state.broken && id === 'conv-1') throw new UnreadableRecordError('groupSessions', 'conv-1');
        return realLoad(id);
      });
      vi.spyOn(storage, 'delete').mockImplementation(async (id) => {
        if (state.deleteFails) throw new Error('delete failed');
        if (id === 'conv-1') state.broken = false;
        await realDelete(id);
      });
      return { storage, state };
    }

    it('is not spent by a wipe that failed, so the next try is not blocked', async () => {
      const api = await mocks();
      const { storage, state } = unreadableStorage();
      const { engine, factory } = setUp({ storage });
      vi.mocked(api.getMlsGroupInfo).mockResolvedValue({ epoch: 1, groupInfo: 'AA==' } as never);
      vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'accepted' } as never);
      factory.joinExternally.mockResolvedValue({
        session: asSession(new FakeSession(2)),
        commitBytes: new Uint8Array([1]),
        groupInfoBytes: new Uint8Array([2]),
      });
      await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);

      state.deleteFails = true;
      await expect(engine.recoverUnreadableGroup('conv-1')).rejects.toThrow('delete failed');
      expect(engine.recoveryWaitMs('conv-1')).toBe(0);

      state.deleteFails = false;
      engine.groupProblems.mark('conv-1', 'state-unreadable');
      await expect(engine.recoverUnreadableGroup('conv-1')).resolves.toBe(true);
    });

    it('is one window shared by both kinds of recovery, and reports what is left of it', async () => {
      const api = await mocks();
      const { storage } = unreadableStorage();
      const { engine, factory } = setUp({ storage });
      vi.mocked(api.getMlsGroupInfo).mockResolvedValue({ epoch: 1, groupInfo: 'AA==' } as never);
      factory.joinExternally.mockRejectedValue(new Error('no snapshot'));
      await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);

      await engine.recoverUnreadableGroup('conv-1');

      expect(engine.recoveryWaitMs('conv-1')).toBeGreaterThan(0);
      // the missing-group path is inside the same window
      await expect(engine.recoverMissingGroup('conv-1')).resolves.toBe(false);
      expect(factory.joinExternally).toHaveBeenCalledTimes(1);
    });

    it('checks whether the copy is readable under the same lock as other work on the group', async () => {
      const api = await mocks();
      const storage = new InMemoryGroupSessionStorage();
      await storage.save('conv-1', new Uint8Array([0]));
      const load = vi.spyOn(storage, 'load');
      const { engine } = setUp({ storage });
      let release!: (value: unknown) => void;
      vi.mocked(api.getMlsHandshakesSince).mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }) as never,
      );
      const busy = engine.syncCommits('conv-1');
      await vi.waitFor(() => expect(api.getMlsHandshakesSince).toHaveBeenCalled());
      engine.groupProblems.mark('conv-1', 'state-unreadable');
      const readsBefore = load.mock.calls.filter(([id]) => id === 'conv-1').length;

      const repair = engine.recoverUnreadableGroup('conv-1');
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(load.mock.calls.filter(([id]) => id === 'conv-1')).toHaveLength(readsBefore);
      release([]);
      await busy;
      await expect(repair).resolves.toBe(true);
    });
  });

  describe('a wipe while a task is running', () => {
    /** A catch-up that is held on the network so a wipe can land while it is in flight. */
    async function heldCatchUp(wipe: () => Promise<void>) {
      const api = await mocks();
      const { engine, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([0]));
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      vi.mocked(api.getMlsHandshakesSince).mockImplementation(async () => {
        await gate;
        return [{ epoch: 0, payload: bytesToBase64(new Uint8Array([0])) }] as never;
      });

      const running = engine.syncCommits('conv-1');
      await vi.waitFor(() => expect(api.getMlsHandshakesSince).toHaveBeenCalled());
      await wipe();
      release();
      return { running, storage };
    }

    it('cannot save the old account\'s state afterwards, even though it began before the wipe', async () => {
      const { running, storage } = await heldCatchUp(wipeAllLocalMlsSecrets);

      await expect(running).rejects.toBeInstanceOf(MlsWipedError);

      expect(await storage.load('conv-1')).toEqual(new Uint8Array([0]));
    });

    it('is dropped by a group-state wipe as well', async () => {
      const { running } = await heldCatchUp(wipeGroupSessionState);

      await expect(running).rejects.toBeInstanceOf(MlsWipedError);
    });

    it('does not block a task that starts after the wipe', async () => {
      await wipeAllLocalMlsSecrets();
      const api = await mocks();
      const { engine, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([0]));
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([
        { epoch: 0, payload: bytesToBase64(new Uint8Array([0])) },
      ] as never);

      await expect(engine.syncCommits('conv-1')).resolves.toBe(1);
    });

    it('is no longer heard by an engine that was disposed', async () => {
      const { engine } = setUp();
      engine.dispose();
      engine.groupProblems.mark('conv-1', 'refused-commit');

      await wipeAllLocalMlsSecrets();

      expect(engine.groupProblems.get('conv-1')).toEqual({ kind: 'refused-commit' });
    });

    it('is heard by a live engine, which forgets its problems', async () => {
      const { engine } = setUp();
      engine.groupProblems.mark('conv-1', 'refused-commit');

      await wipeAllLocalMlsSecrets();

      expect(engine.groupProblems.get('conv-1')).toBeUndefined();
    });
  });

  describe('repairing unreadable state, as the banner shows it', () => {
    it('keeps the group flagged until the rejoin works, so the banner does not flicker', async () => {
      const api = await mocks();
      const { engine, factory, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([7]));
      factory.restore = async () => {
        throw new Error('bad bytes');
      };
      let flagDuringRejoin: unknown;
      vi.mocked(api.getMlsGroupInfo).mockResolvedValue({ epoch: 1, groupInfo: 'AA==' } as never);
      vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'accepted' } as never);
      factory.joinExternally.mockImplementation(async () => {
        flagDuringRejoin = engine.groupProblems.get('conv-1');
        return {
          session: asSession(new FakeSession(2)),
          commitBytes: new Uint8Array([1]),
          groupInfoBytes: new Uint8Array([2]),
        };
      });
      await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);

      await expect(engine.recoverUnreadableGroup('conv-1')).resolves.toBe(true);

      expect(flagDuringRejoin).toEqual({ kind: 'state-unreadable' });
      expect(engine.groupProblems.get('conv-1')).toBeUndefined();
    });

    it('still flags the group, as missing, when the rejoin fails', async () => {
      const api = await mocks();
      const { engine, factory, storage } = setUp();
      await storage.save('conv-1', new Uint8Array([7]));
      factory.restore = async () => {
        throw new Error('bad bytes');
      };
      vi.mocked(api.getMlsGroupInfo).mockResolvedValue({ epoch: 1, groupInfo: 'AA==' } as never);
      factory.joinExternally.mockRejectedValue(new Error('no snapshot'));
      await expect(engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(GroupStateCorruptedError);

      await expect(engine.recoverUnreadableGroup('conv-1')).resolves.toBe(false);

      expect(engine.groupProblems.get('conv-1')).toEqual({ kind: 'state-unavailable' });
    });
  });

  describe('key package top-ups on the poll', () => {
    it('asks for a throttled top-up on every full pass', async () => {
      const api = await mocks();
      const supply = { maybeReplenish: vi.fn().mockResolvedValue(undefined) };
      const { engine } = setUp({ supply });
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([] as never);
      vi.mocked(api.getMlsJoinableConversations).mockResolvedValue({ conversationIds: [] } as never);
      vi.spyOn(engine, 'reconcileMembership').mockResolvedValue({} as never);

      await engine.processPendingMlsWork('full');

      expect(supply.maybeReplenish).toHaveBeenCalledWith();
    });
  });
});
