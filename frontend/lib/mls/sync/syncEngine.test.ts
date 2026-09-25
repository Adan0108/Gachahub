import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from './syncEngine';
import { MembershipEventLog } from './membershipEventLog';
import { InMemoryMembershipEventStorage } from '../storage/membershipEventStorage';
import { TsMlsDeviceIdentityStore, TsMlsGroupSessionFactory } from '../adapter/tsMlsAdapter';
import { InMemoryGroupSessionStorage } from '../storage/groupSessionStorage';
import { bytesToBase64, base64ToBytes } from '../storage/base64';
import {
  EpochConflictError,
  GroupStateUnavailableError,
  MembershipMismatchError,
  NoEncryptableMembersError,
  StaleWelcomeError,
} from '../contract/errors';
import { UnreadableRecordError } from '../storage/mlsEncryptedStore';
import { CommitVerifier } from './commitVerifier';
import type { DeviceCredential, KeyPackageOffer } from '../contract/types';

vi.mock('../../api', () => ({
  api: {
    claimChatDeviceKeyPackages: vi.fn(),
    submitMlsHandshake: vi.fn(),
    getMlsHandshakesSince: vi.fn(),
    getMlsMembershipWork: vi.fn(),
    getMlsPendingWelcomes: vi.fn(),
    consumeMlsWelcome: vi.fn(),
    reportMlsFault: vi.fn(),
    getMlsRoster: vi.fn(),
    getMlsJoinableConversations: vi.fn(),
    getMlsPendingSummary: vi.fn(),
    getMlsGroupInfo: vi.fn(),
    submitMlsExternalJoin: vi.fn(),
  },
}));

interface Device {
  store: TsMlsDeviceIdentityStore;
  factory: TsMlsGroupSessionFactory;
  engine: SyncEngine;
  deviceId: string;
  userId: string;
  credential: DeviceCredential;
  storage: InMemoryGroupSessionStorage;
}

async function setUpDevice(userId: string): Promise<Device> {
  const store = new TsMlsDeviceIdentityStore();
  const credential = await store.provision(userId);
  const factory = new TsMlsGroupSessionFactory(store);
  const storage = new InMemoryGroupSessionStorage();
  const engine = new SyncEngine(factory, credential.deviceId, userId, storage);
  return { store, factory, engine, deviceId: credential.deviceId, userId, credential, storage };
}

/** The engine reloads the saved session for every operation, so a session the test advanced by hand has to be saved. */
async function saveSession(device: Device, session: { serialize(): Promise<Uint8Array> }) {
  await device.storage.save('conv-1', await session.serialize());
}

/** Builds one entry of a claimChatDeviceKeyPackages response from a real key package `device` just generated. */
async function claimResponseFor(device: Device) {
  const [keyPackage] = await device.store.generateKeyPackages(1);
  if (!keyPackage) throw new Error('generateKeyPackages(1) returned nothing');
  return {
    deviceId: device.deviceId,
    ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
    signaturePublicKey: bytesToBase64(device.credential.signatureKey),
    payload: bytesToBase64(keyPackage),
  };
}

/** Makes claimChatDeviceKeyPackages answer per user id with one key package per listed device (none for unlisted users). */
async function mockClaims(claims: Record<string, Device[]>) {
  const { api } = await import('../../api');
  const responses = new Map(
    await Promise.all(
      Object.entries(claims).map(
        async ([userId, devices]) =>
          [userId, await Promise.all(devices.map((device) => claimResponseFor(device)))] as const,
      ),
    ),
  );
  vi.mocked(api.claimChatDeviceKeyPackages).mockImplementation(
    async (userId: string) => responses.get(userId) ?? [],
  );
}

async function offerFor(device: Device): Promise<KeyPackageOffer> {
  const claim = await claimResponseFor(device);
  return {
    credential: {
      userId: device.userId,
      deviceId: device.deviceId,
      signatureKey: device.credential.signatureKey,
    },
    keyPackage: base64ToBytes(claim.payload),
  };
}

/** What the server records for an added device: its owner and registered key. */
function attest(device: Device, overrides: { userId?: string; signatureKey?: Uint8Array } = {}) {
  return {
    deviceId: device.deviceId,
    userId: overrides.userId ?? device.userId,
    signaturePublicKey: bytesToBase64(overrides.signatureKey ?? device.credential.signatureKey),
  };
}

/** What the server records for a removed device: whose leaf it was. */
function attestRemoved(device: Device) {
  return { deviceId: device.deviceId, userId: device.userId };
}

/** The roster the server would return if it recorded exactly the leaves of `session`'s tree - or, with `tamper`, a changed version of them. */
async function serveRosterOf(
  session: {
    listLeaves(): Promise<
      Array<{ userId: string; deviceId: string; signatureKey: Uint8Array }> | undefined
    >;
  },
  tamper: (
    leaves: Array<{ deviceId: string; userId: string; signaturePublicKey: string | null }>,
  ) => void = () => undefined,
) {
  const { api } = await import('../../api');
  vi.mocked(api.getMlsRoster).mockImplementation(async (_conversationId: string, epoch: number) => {
    const leaves = ((await session.listLeaves()) ?? []).map((leaf) => ({
      deviceId: leaf.deviceId,
      userId: leaf.userId,
      signaturePublicKey: bytesToBase64(leaf.signatureKey) as string | null,
    }));
    tamper(leaves);
    return { epoch, leaves };
  });
}

function fakeHandshake(overrides: {
  epoch: number;
  senderDeviceId: string;
  payload: Uint8Array;
  /** What the server attests the Commit does; defaults to a Commit from before membership was tracked. */
  declared?: { addedDevices: unknown[]; removedDevices: unknown[] };
}) {
  return {
    membershipDeclared: overrides.declared !== undefined,
    addedDevices: overrides.declared?.addedDevices ?? [],
    removedDevices: overrides.declared?.removedDevices ?? [],
    id: `hs-${overrides.epoch}-${overrides.senderDeviceId}`,
    conversationId: 'conv-1',
    epoch: overrides.epoch,
    senderDeviceId: overrides.senderDeviceId,
    payload: bytesToBase64(overrides.payload),
    createdAt: new Date().toISOString(),
  };
}

describe('SyncEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createGroup', () => {
    it('creates and persists a new session at epoch 0', async () => {
      const alice = await setUpDevice('user-alice');

      const session = await alice.engine.createGroup('conv-1');

      expect(await session.currentEpoch()).toBe(0);
      await expect(alice.engine.getCurrentEpoch('conv-1')).resolves.toBe(0);
    });
  });

  describe('seedNewGroup', () => {
    it('claims a key package, stages a commit, and submits it', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      await alice.engine.createGroup('conv-1');

      await mockClaims({ 'user-bob': [bob] });
      vi.mocked(api.submitMlsHandshake).mockImplementation(async (_conversationId, payload) => ({
        outcome: 'accepted',
        handshake: fakeHandshake({
          epoch: payload.epoch,
          senderDeviceId: payload.deviceId,
          payload: base64ToBytes(payload.payload),
        }),
      }));

      const epoch = await alice.engine.seedNewGroup('conv-1', 'user-bob');

      expect(epoch).toBe(1);
      expect(api.claimChatDeviceKeyPackages).toHaveBeenCalledWith('user-bob');
      expect(api.claimChatDeviceKeyPackages).toHaveBeenCalledWith('user-alice', {
        excludeDeviceId: alice.deviceId,
      });
      expect(api.submitMlsHandshake).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          deviceId: alice.deviceId,
          epoch: 0,
          welcome: expect.objectContaining({ recipientDeviceIds: [bob.deviceId] }),
          addedDeviceIds: [bob.deviceId],
          removedDeviceIds: [],
        }),
      );
    });

    it('adds every device of the recipient and every other device of the sender in one commit', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const alicePhone = await setUpDevice('user-alice');
      const bobLaptop = await setUpDevice('user-bob');
      const bobPhone = await setUpDevice('user-bob');
      await alice.engine.createGroup('conv-1');

      await mockClaims({ 'user-bob': [bobLaptop, bobPhone], 'user-alice': [alicePhone] });
      vi.mocked(api.submitMlsHandshake).mockImplementation(async (_conversationId, payload) => ({
        outcome: 'accepted',
        handshake: fakeHandshake({
          epoch: payload.epoch,
          senderDeviceId: payload.deviceId,
          payload: base64ToBytes(payload.payload),
        }),
      }));

      await alice.engine.seedNewGroup('conv-1', 'user-bob');

      expect(api.submitMlsHandshake).toHaveBeenCalledTimes(1);
      const [, submitted] = vi.mocked(api.submitMlsHandshake).mock.calls[0]!;
      expect(
        [...submitted.welcome!.recipientDeviceIds].sort(),
      ).toEqual([bobLaptop.deviceId, bobPhone.deviceId, alicePhone.deviceId].sort());
    });

    it('throws EpochConflictError and catches the local session up when another commit wins the epoch race', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const carol = await setUpDevice('user-carol');
      const dave = await setUpDevice('user-dave');

      // Real group: alice creates it and adds bob for real, so bob has his
      // own genuine member session (not a copy of alice's private state).
      const aliceSession = await alice.engine.createGroup('conv-1');
      const addBob = await aliceSession.stageCommit({
        added: [await offerFor(bob)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      const bobWelcome = addBob.welcome;
      if (!bobWelcome) throw new Error('missing Bob Welcome');
      const bobSession = await bob.factory.joinFromWelcome('conv-1', bobWelcome.welcomeBytes);
      await bob.engine.forgetConversation('conv-1'); // clear any stale cache before seeding storage directly
      const bobStorage = new InMemoryGroupSessionStorage();
      await bobStorage.save('conv-1', await bobSession.serialize());
      const bobEngine = new SyncEngine(bob.factory, bob.deviceId, bob.userId, bobStorage);

      // Alice wins the race for epoch 1 by adding dave...
      const addDave = await aliceSession.stageCommit({
        added: [await offerFor(dave)],
        removed: [],
      });
      await aliceSession.commitAccepted();

      // ...while bob, also at epoch 1, tries to add carol and loses.
      await mockClaims({ 'user-carol': [carol] });
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({
        outcome: 'conflict',
        handshake: fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addDave.wireBytes,
        }),
      });

      await expect(bobEngine.seedNewGroup('conv-1', 'user-carol')).rejects.toThrow(
        EpochConflictError,
      );

      // Bob's session should now be caught up on alice's winning commit.
      await expect(bobEngine.getCurrentEpoch('conv-1')).resolves.toBe(2);
    });
  });

  describe('seedNewGroupWithMembers', () => {
    it('adds every device of every founding member, plus the creator\'s other devices, in one commit', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const alicePhone = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const carolLaptop = await setUpDevice('user-carol');
      const carolPhone = await setUpDevice('user-carol');
      await alice.engine.createGroup('conv-1');

      await mockClaims({
        'user-bob': [bob],
        'user-carol': [carolLaptop, carolPhone],
        'user-alice': [alicePhone],
      });
      vi.mocked(api.submitMlsHandshake).mockImplementation(async (_conversationId, payload) => ({
        outcome: 'accepted',
        handshake: fakeHandshake({
          epoch: payload.epoch,
          senderDeviceId: payload.deviceId,
          payload: base64ToBytes(payload.payload),
        }),
      }));

      const epoch = await alice.engine.seedNewGroupWithMembers('conv-1', [
        'user-bob',
        'user-carol',
      ]);

      expect(epoch).toBe(1);
      expect(api.submitMlsHandshake).toHaveBeenCalledTimes(1);
      const [, submitted] = vi.mocked(api.submitMlsHandshake).mock.calls[0]!;
      expect(submitted.addedDeviceIds.sort()).toEqual(
        [bob.deviceId, carolLaptop.deviceId, carolPhone.deviceId, alicePhone.deviceId].sort(),
      );
      expect(
        [...submitted.welcome!.recipientDeviceIds].sort(),
      ).toEqual(
        [bob.deviceId, carolLaptop.deviceId, carolPhone.deviceId, alicePhone.deviceId].sort(),
      );
    });

    // regression: this used to return epoch 0 and quietly move on. Without a Commit, this
    // device's leaf is never recorded server-side, so nothing can ever bootstrap the group
    // afterward - not membership work (needs this device already in the roster) and not
    // self-join (needs a published snapshot). Every message sent into that group was encrypted
    // to an audience of one, forever, with no error shown.
    it('refuses to seed a group with nobody to add, instead of silently leaving it at epoch 0', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      await alice.engine.createGroup('conv-1');
      await mockClaims({}); // nobody is ACTIVE yet (all invitees still PENDING), and alice has no other devices

      await expect(alice.engine.seedNewGroupWithMembers('conv-1', [])).rejects.toThrow(
        NoEncryptableMembersError,
      );
      expect(api.submitMlsHandshake).not.toHaveBeenCalled();
    });

    it('seeds a group for a single member the same way seedNewGroup does', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      await alice.engine.createGroup('conv-1');
      await mockClaims({ 'user-bob': [bob] });
      vi.mocked(api.submitMlsHandshake).mockImplementation(async (_conversationId, payload) => ({
        outcome: 'accepted',
        handshake: fakeHandshake({
          epoch: payload.epoch,
          senderDeviceId: payload.deviceId,
          payload: base64ToBytes(payload.payload),
        }),
      }));

      const epoch = await alice.engine.seedNewGroupWithMembers('conv-1', ['user-bob']);

      expect(epoch).toBe(1);
      expect(api.claimChatDeviceKeyPackages).toHaveBeenCalledWith('user-bob');
    });
  });

  describe('submitMembershipChange', () => {
    it('declares the devices it removes, so the server can check them against the roster', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      await alice.engine.createGroup('conv-1');
      await mockClaims({ 'user-bob': [bob] });
      vi.mocked(api.submitMlsHandshake).mockImplementation(async (_conversationId, payload) => ({
        outcome: 'accepted',
        handshake: fakeHandshake({
          epoch: payload.epoch,
          senderDeviceId: payload.deviceId,
          payload: base64ToBytes(payload.payload),
        }),
      }));
      await alice.engine.seedNewGroup('conv-1', 'user-bob');
      vi.mocked(api.submitMlsHandshake).mockClear();

      await alice.engine.submitMembershipChange('conv-1', {
        added: [],
        removed: [bob.credential],
      });

      expect(api.submitMlsHandshake).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          welcome: undefined,
          addedDeviceIds: [],
          removedDeviceIds: [bob.deviceId],
        }),
      );
    });
  });

  describe('verifying a commit against what the server recorded (real MLS)', () => {
    /** alice founds the group and adds bob; returns alice's session and bob's engine, seeded with his real member state. */
    async function groupWithBobVerifying() {
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const aliceSession = await alice.engine.createGroup('conv-1');
      const addBob = await aliceSession.stageCommit({
        added: [await offerFor(bob)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      const bobSession = await bob.factory.joinFromWelcome(
        'conv-1',
        addBob.welcome!.welcomeBytes,
      );
      const storage = new InMemoryGroupSessionStorage();
      await storage.save('conv-1', await bobSession.serialize());
      const bobEngine = new SyncEngine(bob.factory, bob.deviceId, bob.userId, storage);
      await serveRosterOf(aliceSession);
      return { alice, bob, aliceSession, bobEngine, bobStorage: storage };
    }

    async function serveHandshake(handshake: unknown) {
      const { api } = await import('../../api');
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([handshake] as never);
    }

    it('applies a commit that did exactly what its sender declared', async () => {
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
          declared: { addedDevices: [attest(carol)], removedDevices: [] },
        }),
      );

      await expect(bobEngine.syncCommits('conv-1')).resolves.toBe(2);
    });

    it('records a join only from a commit it verified, and nothing from a refused one', async () => {
      const { alice, aliceSession, bob, bobStorage } = await groupWithBobVerifying();
      const log = new MembershipEventLog(new InMemoryMembershipEventStorage());
      const bobEngine = new SyncEngine(
        bob.factory,
        bob.deviceId,
        bob.userId,
        bobStorage,
        undefined,
        log,
      );
      const carol = await setUpDevice('user-carol');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      const handshake = (declared: { addedDevices: unknown[]; removedDevices: unknown[] }) =>
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
          declared,
        });

      await serveHandshake(handshake({ addedDevices: [], removedDevices: [] }));
      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(MembershipMismatchError);
      await expect(log.list('conv-1')).resolves.toEqual([]);

      await serveHandshake(handshake({ addedDevices: [attest(carol)], removedDevices: [] }));
      await bobEngine.syncCommits('conv-1');
      await expect(log.list('conv-1')).resolves.toEqual([
        expect.objectContaining({ kind: 'joined', userId: 'user-carol', deviceId: carol.deviceId }),
      ]);
    });

    it('refuses a commit that added a device it did not declare, and stays at the epoch it could verify', async () => {
      const { alice, aliceSession, bob, bobEngine, bobStorage } = await groupWithBobVerifying();
      const sneaky = await setUpDevice('user-mallory');
      const addSneaky = await aliceSession.stageCommit({
        added: [await offerFor(sneaky)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addSneaky.wireBytes,
          declared: { addedDevices: [], removedDevices: [] },
        }),
      );

      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(MembershipMismatchError);

      // in memory and on disk, bob is still at the epoch before the refused commit
      await expect(bobEngine.getCurrentEpoch('conv-1')).resolves.toBe(1);
      const saved = await bob.factory.restore('conv-1', (await bobStorage.load('conv-1'))!);
      await expect(saved.currentEpoch()).resolves.toBe(1);
    });

    it('reports a refused commit to the server once, however often it is re-detected', async () => {
      const { api } = await import('../../api');
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const sneaky = await setUpDevice('user-mallory');
      const addSneaky = await aliceSession.stageCommit({
        added: [await offerFor(sneaky)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addSneaky.wireBytes,
          declared: { addedDevices: [], removedDevices: [] },
        }),
      );
      vi.mocked(api.reportMlsFault).mockResolvedValue({ recorded: true } as never);

      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(MembershipMismatchError);
      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(MembershipMismatchError);

      expect(api.reportMlsFault).toHaveBeenCalledTimes(1);
      expect(api.reportMlsFault).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ epoch: 1, reason: expect.any(String) }),
      );
    });

    it('refuses a declared commit that leaves the tree disagreeing with the server roster, and stays at the epoch it could verify', async () => {
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
          declared: { addedDevices: [attest(carol)], removedDevices: [] },
        }),
      );
      // the founder's leaf was labelled as someone else all along
      await serveRosterOf(aliceSession, (leaves) => {
        leaves.find((leaf) => leaf.deviceId === alice.deviceId)!.userId = 'user-victim';
      });

      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(MembershipMismatchError);
      await expect(bobEngine.getCurrentEpoch('conv-1')).resolves.toBe(1);
    });

    it('checks the tree once for a whole catch-up batch, not once per commit', async () => {
      const { api } = await import('../../api');
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const dave = await setUpDevice('user-dave');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      const addDave = await aliceSession.stageCommit({
        added: [await offerFor(dave)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
          declared: { addedDevices: [attest(carol)], removedDevices: [] },
        }),
        fakeHandshake({
          epoch: 2,
          senderDeviceId: alice.deviceId,
          payload: addDave.wireBytes,
          declared: { addedDevices: [attest(dave)], removedDevices: [] },
        }),
      ] as never);
      vi.mocked(api.getMlsRoster).mockClear();

      await expect(bobEngine.syncCommits('conv-1')).resolves.toBe(3);

      expect(api.getMlsRoster).toHaveBeenCalledTimes(1);
    });

    it('reports and refuses a commit the server accepted but this device could not even apply', async () => {
      const { api } = await import('../../api');
      const { bobEngine } = await groupWithBobVerifying();
      vi.mocked(api.reportMlsFault).mockResolvedValue({ recorded: true } as never);
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: 'device-x',
          payload: new Uint8Array([9, 9, 9]),
          declared: { addedDevices: [], removedDevices: [] },
        }),
      );

      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(MembershipMismatchError);
      expect(api.reportMlsFault).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ epoch: 1 }),
      );
    });

    it('lets the device being removed process its own removal, as declared', async () => {
      const { alice, aliceSession, bob, bobEngine } = await groupWithBobVerifying();
      const removeBob = await aliceSession.stageCommit({
        added: [],
        removed: [bob.credential],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: removeBob.wireBytes,
          declared: { addedDevices: [], removedDevices: [attestRemoved(bob)] },
        }),
      );

      await expect(bobEngine.syncCommits('conv-1')).resolves.toBeDefined();
    });

    it('refuses a leaf that carries the right device id but not that device’s registered key', async () => {
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
          // the server's registry says carol's device has a different key than the leaf carries
          declared: {
            addedDevices: [attest(carol, { signatureKey: new Uint8Array([9, 9, 9]) })],
            removedDevices: [],
          },
        }),
      );

      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(/registered key/);
      await expect(bobEngine.getCurrentEpoch('conv-1')).resolves.toBe(1);
    });

    it('refuses a leaf that is labelled as a different user than the device belongs to', async () => {
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
          declared: {
            addedDevices: [attest(carol, { userId: 'user-somebody-else' })],
            removedDevices: [],
          },
        }),
      );

      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(/registered owner/);
    });

    it('once a group has had a declared commit, refuses a later one the server calls undeclared - even after a reload', async () => {
      const { alice, aliceSession, bob, bobEngine, bobStorage } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const dave = await setUpDevice('user-dave');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
          declared: { addedDevices: [attest(carol)], removedDevices: [] },
        }),
      );
      await bobEngine.syncCommits('conv-1');

      const addDave = await aliceSession.stageCommit({
        added: [await offerFor(dave)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 2,
          senderDeviceId: alice.deviceId,
          payload: addDave.wireBytes,
          // a server (or anyone) quietly reporting the commit as undeclared to skip the check
        }),
      );

      // a fresh engine over the same storage, as after a reload: the rule must still hold
      const reloaded = new SyncEngine(bob.factory, bob.deviceId, bob.userId, bobStorage);
      await expect(reloaded.syncCommits('conv-1')).rejects.toThrow(/undeclared/);
      await expect(reloaded.getCurrentEpoch('conv-1')).resolves.toBe(2);
    });

    it('refuses a commit that removed a device it did not declare', async () => {
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
          declared: { addedDevices: [attest(carol)], removedDevices: [] },
        }),
      );
      await bobEngine.syncCommits('conv-1');

      const removeCarol = await aliceSession.stageCommit({
        added: [],
        removed: [carol.credential],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 2,
          senderDeviceId: alice.deviceId,
          payload: removeCarol.wireBytes,
          declared: { addedDevices: [], removedDevices: [] },
        }),
      );

      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(MembershipMismatchError);
      await expect(bobEngine.getCurrentEpoch('conv-1')).resolves.toBe(2);
    });

    it('refuses a commit whose handshake row came back without the declaration at all', async () => {
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      const row: Record<string, unknown> = {
        ...fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
          declared: { addedDevices: [attest(carol)], removedDevices: [] },
        }),
      };
      delete row.membershipDeclared;
      delete row.addedDeviceIds;
      delete row.removedDeviceIds;
      await serveHandshake(row);

      await expect(bobEngine.syncCommits('conv-1')).rejects.toThrow(MembershipMismatchError);
    });

    it('applies a commit from before membership was tracked without checking it', async () => {
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await serveHandshake(
        fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addCarol.wireBytes,
        }),
      );

      await expect(bobEngine.syncCommits('conv-1')).resolves.toBe(2);
    });

    it('refuses a commit delivered outside catch-up, where there is no declaration to check it against', async () => {
      const { aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();

      await expect(bobEngine.processIncoming('conv-1', addCarol.wireBytes)).rejects.toThrow(
        MembershipMismatchError,
      );
      await expect(bobEngine.getCurrentEpoch('conv-1')).resolves.toBe(1);
    });

    it('refuses a winning commit that does not match its declaration, instead of reporting an ordinary lost race', async () => {
      const { api } = await import('../../api');
      const { alice, aliceSession, bobEngine } = await groupWithBobVerifying();
      const carol = await setUpDevice('user-carol');
      const sneaky = await setUpDevice('user-mallory');
      const winner = await aliceSession.stageCommit({
        added: [await offerFor(sneaky)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await mockClaims({ 'user-carol': [carol] });
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({
        outcome: 'conflict',
        handshake: fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: winner.wireBytes,
          declared: { addedDevices: [], removedDevices: [] },
        }),
      });

      await expect(bobEngine.seedNewGroup('conv-1', 'user-carol')).rejects.toThrow(
        MembershipMismatchError,
      );
    });
  });

  describe('reconcileMembership (real MLS)', () => {
    async function acceptEverything() {
      const { api } = await import('../../api');
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([]);
      vi.mocked(api.submitMlsHandshake).mockImplementation(async (_conversationId, payload) => ({
        outcome: 'accepted',
        handshake: fakeHandshake({
          epoch: payload.epoch,
          senderDeviceId: payload.deviceId,
          payload: base64ToBytes(payload.payload),
        }),
      }));
      return api;
    }

    /** Serves this work once, then nothing - as the server would after the Commit is accepted. */
    async function serveWorkOnce(items: unknown[]) {
      const { api } = await import('../../api');
      vi.mocked(api.getMlsMembershipWork)
        .mockResolvedValueOnce({ items, nextCursor: null })
        .mockResolvedValue({ items: [], nextCursor: null });
    }

    it('removes a leaving member so they cannot read what is sent next', async () => {
      const api = await acceptEverything();
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const carol = await setUpDevice('user-carol');

      const aliceSession = await alice.engine.createGroup('conv-1');
      const added = await aliceSession.stageCommit({
        added: [await offerFor(bob), await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await saveSession(alice, aliceSession);
      const welcomeFor = (deviceId: string) =>
        added.welcome!.welcomeBytes;
      const carolSession = await carol.factory.joinFromWelcome(
        'conv-1',
        welcomeFor(carol.deviceId),
      );

      await serveWorkOnce([
        {
          conversationId: 'conv-1',
          epoch: 1,
          add: [],
          remove: [{ userId: 'user-carol', deviceId: carol.deviceId }],
          unreachableUserIds: [],
        },
      ]);

      const summary = await alice.engine.reconcileMembership();

      expect(summary.outcomes).toEqual([{ conversationId: 'conv-1', outcome: 'committed' }]);
      expect(api.submitMlsHandshake).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ removedDeviceIds: [carol.deviceId], addedDeviceIds: [] }),
      );

      const removalCommit = base64ToBytes(
        vi.mocked(api.submitMlsHandshake).mock.calls[0]![1].payload,
      );
      await carolSession.process(removalCommit);
      const secret = await alice.engine.encryptMessage('conv-1', {
        v: 1,
        type: 'text',
        body: 'carol must not read this',
      });
      await expect(carolSession.process(secret.wireBytes)).rejects.toThrow();
    });

    it('adds a member waiting to join so their device can read what is sent next', async () => {
      const api = await acceptEverything();
      const alice = await setUpDevice('user-alice');
      const dave = await setUpDevice('user-dave');
      await alice.engine.createGroup('conv-1');

      await mockClaims({ 'user-dave': [dave] });
      await serveWorkOnce([
        {
          conversationId: 'conv-1',
          epoch: 0,
          add: [{ userId: 'user-dave', deviceId: dave.deviceId }],
          remove: [],
          unreachableUserIds: [],
        },
      ]);

      const summary = await alice.engine.reconcileMembership();

      expect(summary.outcomes).toEqual([{ conversationId: 'conv-1', outcome: 'committed' }]);
      const submitted = vi.mocked(api.submitMlsHandshake).mock.calls[0]![1];
      expect(submitted.addedDeviceIds).toEqual([dave.deviceId]);

      const daveSession = await dave.factory.joinFromWelcome(
        'conv-1',
        base64ToBytes(submitted.welcome!.payload),
      );
      const wire = await alice.engine.encryptMessage('conv-1', {
        v: 1,
        type: 'text',
        body: 'welcome dave',
      });
      const result = await daveSession.process(wire.wireBytes);
      expect(result.kind).toBe('application');
    });

    it('does not commit when the server’s epoch is not the one this device is at', async () => {
      const api = await acceptEverything();
      const alice = await setUpDevice('user-alice');
      const dave = await setUpDevice('user-dave');
      await alice.engine.createGroup('conv-1');
      await mockClaims({ 'user-dave': [dave] });
      await serveWorkOnce([
        {
          conversationId: 'conv-1',
          epoch: 7,
          add: [{ userId: 'user-dave', deviceId: dave.deviceId }],
          remove: [],
          unreachableUserIds: [],
        },
      ]);

      const summary = await alice.engine.reconcileMembership();

      expect(summary.outcomes).toEqual([{ conversationId: 'conv-1', outcome: 'stale' }]);
      expect(api.submitMlsHandshake).not.toHaveBeenCalled();
      expect(api.claimChatDeviceKeyPackages).not.toHaveBeenCalled();
    });

    it('runs queued calls one after another', async () => {
      await acceptEverything();
      const alice = await setUpDevice('user-alice');
      await alice.engine.createGroup('conv-1');
      const { api } = await import('../../api');
      const seen: string[] = [];
      vi.mocked(api.getMlsMembershipWork).mockImplementation(async () => {
        seen.push('start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push('end');
        return { items: [], nextCursor: null };
      });

      await Promise.all([alice.engine.reconcileMembership(), alice.engine.reconcileMembership()]);

      expect(seen).toEqual(['start', 'end', 'start', 'end']);
    });
  });

  describe('syncCommits', () => {
    it('applies missed handshakes in order and advances the epoch', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const carol = await setUpDevice('user-carol');
      const dave = await setUpDevice('user-dave');

      const aliceSession = await alice.engine.createGroup('conv-1');
      const addBob = await aliceSession.stageCommit({
        added: [await offerFor(bob)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      const bobWelcome = addBob.welcome;
      if (!bobWelcome) throw new Error('missing Bob Welcome');
      const bobSession = await bob.factory.joinFromWelcome('conv-1', bobWelcome.welcomeBytes);
      const bobStorage = new InMemoryGroupSessionStorage();
      await bobStorage.save('conv-1', await bobSession.serialize());
      const bobEngine = new SyncEngine(bob.factory, bob.deviceId, bob.userId, bobStorage);

      // Bob goes offline from here - alice adds carol, then dave, without bob ever processing either.
      const addCarol = await aliceSession.stageCommit({
        added: [await offerFor(carol)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      const addDave = await aliceSession.stageCommit({
        added: [await offerFor(dave)],
        removed: [],
      });
      await aliceSession.commitAccepted();

      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([
        fakeHandshake({ epoch: 1, senderDeviceId: alice.deviceId, payload: addCarol.wireBytes }),
        fakeHandshake({ epoch: 2, senderDeviceId: alice.deviceId, payload: addDave.wireBytes }),
      ]);

      const finalEpoch = await bobEngine.syncCommits('conv-1');

      expect(finalEpoch).toBe(3);
      expect(api.getMlsHandshakesSince).toHaveBeenCalledWith('conv-1', 1);
    });

    it('throws when a fetched handshake is rejected instead of silently continuing', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      await alice.engine.createGroup('conv-1');

      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([
        fakeHandshake({
          epoch: 0,
          senderDeviceId: 'someone',
          payload: new TextEncoder().encode('not a real mls message'),
        }),
      ]);

      await expect(alice.engine.syncCommits('conv-1')).rejects.toThrow(/malformed/);
    });
  });

  describe('processPendingWelcomes', () => {
    it('joins and consumes each pending Welcome', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');

      const aliceSession = await alice.engine.createGroup('conv-1');
      const addBob = await aliceSession.stageCommit({
        added: [await offerFor(bob)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      const bobWelcome = addBob.welcome;
      if (!bobWelcome) throw new Error('missing Bob Welcome');

      await serveRosterOf(aliceSession);
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([
        {
          id: 'welcome-1',
          conversationId: 'conv-1',
          payload: bytesToBase64(bobWelcome.welcomeBytes),
          createdAt: new Date().toISOString(),
        },
      ]);

      const result = await bob.engine.processPendingWelcomes();

      expect(result.joined).toEqual(['conv-1']);
      expect(result.failures).toEqual([]);
      expect(api.consumeMlsWelcome).toHaveBeenCalledWith(bob.deviceId, 'welcome-1');
      await expect(bob.engine.getCurrentEpoch('conv-1')).resolves.toBe(1);
    });

    it('refuses a Welcome whose tree has a leaf under someone else name, and keeps nothing of it', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const aliceSession = await alice.engine.createGroup('conv-1');
      const addBob = await aliceSession.stageCommit({
        added: [await offerFor(bob)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      // the server has the founder's device under a different owner than the tree's leaf says
      await serveRosterOf(aliceSession, (leaves) => {
        const founder = leaves.find((leaf) => leaf.deviceId === alice.deviceId)!;
        founder.userId = 'user-someone-else';
      });
      vi.mocked(api.reportMlsFault).mockResolvedValue({ recorded: true } as never);
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([
        {
          id: 'welcome-1',
          conversationId: 'conv-1',
          payload: bytesToBase64(
            addBob.welcome!.welcomeBytes,
          ),
          createdAt: new Date().toISOString(),
        },
      ]);

      const result = await bob.engine.processPendingWelcomes();

      expect(result.joined).toEqual([]);
      expect(result.failures[0]?.error).toBeInstanceOf(MembershipMismatchError);
      // a definite refusal: the Welcome is dropped so it is not retried every poll
      expect(api.consumeMlsWelcome).toHaveBeenCalledWith(bob.deviceId, 'welcome-1');
      await expect(bob.engine.getCurrentEpoch('conv-1')).rejects.toThrow();
      expect(api.reportMlsFault).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ epoch: 0 }),
      );
    });

    it('keeps the key package when the roster cannot be fetched, so the retry can still join', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const aliceSession = await alice.engine.createGroup('conv-1');
      const addBob = await aliceSession.stageCommit({
        added: [await offerFor(bob)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([
        {
          id: 'welcome-1',
          conversationId: 'conv-1',
          payload: bytesToBase64(
            addBob.welcome!.welcomeBytes,
          ),
          createdAt: new Date().toISOString(),
        },
      ]);

      vi.mocked(api.getMlsRoster).mockRejectedValueOnce(new Error('offline'));
      const first = await bob.engine.processPendingWelcomes();
      expect(first.joined).toEqual([]);
      expect(api.consumeMlsWelcome).not.toHaveBeenCalled();

      await serveRosterOf(aliceSession);
      const retry = await bob.engine.processPendingWelcomes();

      expect(retry.failures).toEqual([]);
      expect(retry.joined).toEqual(['conv-1']);
      await expect(bob.engine.getCurrentEpoch('conv-1')).resolves.toBe(1);
    });

    // regression: a Welcome can be re-delivered for a conversation this
    // device already joined and advanced past epoch 0 (e.g. the earlier
    // join succeeded but consumeMlsWelcome then failed, leaving the
    // Welcome pending) - rejoining it used to silently rewind the session.
    it('does not rejoin (rewind) an already-advanced session when a stale Welcome for the same conversation is re-delivered', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');

      const bobSession = await bob.engine.createGroup('conv-1');
      await bobSession.stageCommit({
        added: [await offerFor(alice)],
        removed: [],
      });
      await bobSession.commitAccepted();
      await saveSession(bob, bobSession);
      await expect(bob.engine.getCurrentEpoch('conv-1')).resolves.toBe(1);

      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([
        {
          id: 'welcome-stale',
          conversationId: 'conv-1',
          // Not a decodable Welcome, so it can only be stale.
          payload: bytesToBase64(new TextEncoder().encode('stale-welcome')),
          createdAt: new Date().toISOString(),
        },
      ]);

      const result = await bob.engine.processPendingWelcomes();

      // Not a new join - the session already existed before this call, so
      // this stale Welcome is only ever consumed, never counted as joined.
      expect(result.joined).toEqual([]);
      expect(result.failures).toEqual([]);
      expect(api.consumeMlsWelcome).toHaveBeenCalledWith(bob.deviceId, 'welcome-stale');
      await expect(bob.engine.getCurrentEpoch('conv-1')).resolves.toBe(1);
    });

    it('joins a Welcome for a later epoch and replaces the old session - a device removed and re-added must be able to rejoin', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const aliceSession = await alice.engine.createGroup('conv-1');
      const first = await aliceSession.stageCommit({ added: [await offerFor(bob)], removed: [] });
      await aliceSession.commitAccepted();
      await serveRosterOf(aliceSession);
      const welcomeOf = (welcome: typeof first.welcome) => ({
        id: `welcome-${welcome!.deviceIds.length}-${Math.random()}`,
        conversationId: 'conv-1',
        payload: bytesToBase64(welcome!.welcomeBytes),
        createdAt: new Date().toISOString(),
      });
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([welcomeOf(first.welcome)]);
      await bob.engine.processPendingWelcomes();
      await expect(bob.engine.getCurrentEpoch('conv-1')).resolves.toBe(1);

      // bob is removed and re-added while his device never saw it: he still holds the epoch-1 session
      await aliceSession.stageCommit({ added: [], removed: [bob.credential] });
      await aliceSession.commitAccepted();
      const readd = await aliceSession.stageCommit({ added: [await offerFor(bob)], removed: [] });
      await aliceSession.commitAccepted();
      const rejoin = welcomeOf(readd.welcome);
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([rejoin]);
      vi.mocked(api.consumeMlsWelcome).mockClear();

      const result = await bob.engine.processPendingWelcomes();

      expect(result.joined).toEqual(['conv-1']);
      expect(api.consumeMlsWelcome).toHaveBeenCalledWith(bob.deviceId, rejoin.id);
      await expect(bob.engine.getCurrentEpoch('conv-1')).resolves.toBe(3);
    });

    it('consumes a re-delivered Welcome for a group the device already joined, without rewinding it', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const aliceSession = await alice.engine.createGroup('conv-1');
      const added = await aliceSession.stageCommit({ added: [await offerFor(bob)], removed: [] });
      await aliceSession.commitAccepted();
      await serveRosterOf(aliceSession);
      const welcome = {
        id: 'welcome-1',
        conversationId: 'conv-1',
        payload: bytesToBase64(
          added.welcome!.welcomeBytes,
        ),
        createdAt: new Date().toISOString(),
      };
      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([welcome]);
      await bob.engine.processPendingWelcomes();
      vi.mocked(api.consumeMlsWelcome).mockClear();

      const again = await bob.engine.processPendingWelcomes();

      expect(again.joined).toEqual([]);
      expect(again.failures).toEqual([]);
      expect(api.consumeMlsWelcome).toHaveBeenCalledWith(bob.deviceId, 'welcome-1');
      await expect(bob.engine.getCurrentEpoch('conv-1')).resolves.toBe(1);
    });

    it('spends the key package of a Welcome it discards as stale, so no private key is left to open it', async () => {
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const aliceSession = await alice.engine.createGroup('conv-1');
      const added = await aliceSession.stageCommit({ added: [await offerFor(bob)], removed: [] });
      await aliceSession.commitAccepted();
      const before = bob.store.keyPackagesById.size;

      await expect(
        bob.factory.joinFromWelcome(
          'conv-1',
          added.welcome!.welcomeBytes,
          {
            verify: async () => {
              throw new StaleWelcomeError();
            },
          },
        ),
      ).rejects.toBeInstanceOf(StaleWelcomeError);

      expect(bob.store.keyPackagesById.size).toBe(before - 1);
    });

    it('records a failure and does not consume a Welcome that fails to join, without aborting the batch', async () => {
      const { api } = await import('../../api');
      const bob = await setUpDevice('user-bob');

      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([
        {
          id: 'welcome-bad',
          conversationId: 'conv-1',
          payload: bytesToBase64(new TextEncoder().encode('garbage')),
          createdAt: new Date().toISOString(),
        },
      ]);

      const result = await bob.engine.processPendingWelcomes();

      expect(result.joined).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.welcomeId).toBe('welcome-bad');
      expect(api.consumeMlsWelcome).not.toHaveBeenCalled();
    });
  });

  describe('getSession failure path', () => {
    it('throws GroupStateUnavailableError for a conversation this device never joined or created', async () => {
      const alice = await setUpDevice('user-alice');

      await expect(alice.engine.syncCommits('never-heard-of-it')).rejects.toThrow(
        GroupStateUnavailableError,
      );
    });
  });

  describe('encryptMessage', () => {
    it('persists after every call', async () => {
      const alice = await setUpDevice('user-alice');
      const storage = new InMemoryGroupSessionStorage();
      const engine = new SyncEngine(alice.factory, alice.deviceId, alice.userId, storage);
      await engine.createGroup('conv-1');
      const saveSpy = vi.spyOn(storage, 'save');

      await engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'hi' });
      await engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'again' });

      const stateSaves = saveSpy.mock.calls.filter(([key]) => key === 'conv-1');
      expect(stateSaves).toHaveLength(2);
    });
  });

  describe('the regular poll (processPendingMlsWork)', () => {
    const spyAll = (engine: SyncEngine) => ({
      welcomes: vi
        .spyOn(engine, 'processPendingWelcomes')
        .mockResolvedValue({ joined: [], failures: [] }),
      joins: vi.spyOn(engine, 'joinGroupsByItself').mockResolvedValue([]),
      work: vi.spyOn(engine, 'reconcileMembership').mockResolvedValue({ outcomes: [] }),
    });

    it('costs one probe and nothing else when nothing is waiting', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const spies = spyAll(alice.engine);
      vi.mocked(api.getMlsPendingSummary).mockResolvedValue({
        welcomes: 0,
        joinable: false,
        membershipWork: false,
      });

      await alice.engine.processPendingMlsWork('pending');

      expect(api.getMlsPendingSummary).toHaveBeenCalledWith(alice.deviceId);
      expect(spies.welcomes).not.toHaveBeenCalled();
      expect(spies.joins).not.toHaveBeenCalled();
      expect(spies.work).not.toHaveBeenCalled();
    });

    it('runs only the steps the probe says are waiting', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const spies = spyAll(alice.engine);
      vi.mocked(api.getMlsPendingSummary).mockResolvedValue({
        welcomes: 1,
        joinable: false,
        membershipWork: true,
      });

      await alice.engine.processPendingMlsWork('pending');

      expect(spies.welcomes).toHaveBeenCalled();
      expect(spies.joins).not.toHaveBeenCalled();
      expect(spies.work).toHaveBeenCalledWith({ scope: 'pending' });
    });

    it('skips the probe on a full pass and runs everything', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const spies = spyAll(alice.engine);

      await alice.engine.processPendingMlsWork('full');

      expect(api.getMlsPendingSummary).not.toHaveBeenCalled();
      expect(spies.welcomes).toHaveBeenCalled();
      expect(spies.joins).toHaveBeenCalledWith({ scope: 'full' });
      expect(spies.work).toHaveBeenCalledWith({ scope: 'full' });
    });
  });

  describe('joining a group by itself (real MLS)', () => {
    /** alice and bob are in a group whose newest snapshot is published; carol wants in with no member online. */
    async function groupWithPublishedSnapshot() {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const carol = await setUpDevice('user-carol');
      const aliceSession = await alice.engine.createGroup('conv-1');
      const staged = await aliceSession.stageCommit({ added: [await offerFor(bob)], removed: [] });
      await aliceSession.commitAccepted();
      await saveSession(alice, aliceSession);
      await serveRosterOf(aliceSession);
      vi.mocked(api.getMlsGroupInfo).mockResolvedValue({
        epoch: 1,
        groupInfo: bytesToBase64(staged.groupInfo),
      });
      // the server accepting the join: hand the members the commit, exactly as it would be stored
      let submitted: Uint8Array | undefined;
      vi.mocked(api.submitMlsExternalJoin).mockImplementation(
        async (_c: string, body: { payload: string }) => {
          submitted = base64ToBytes(body.payload);
          return { outcome: 'accepted' };
        },
      );
      return { api, alice, aliceSession, carol, submittedCommit: () => submitted };
    }

    it('joins, saves the group, and reads what the members send afterwards', async () => {
      const { alice, aliceSession, carol, submittedCommit } = await groupWithPublishedSnapshot();

      await expect(carol.engine.joinByExternalCommit('conv-1')).resolves.toBe(true);

      await expect(aliceSession.process(submittedCommit()!)).resolves.toMatchObject({
        kind: 'commit',
        epoch: 2,
      });
      await expect(carol.engine.getCurrentEpoch('conv-1')).resolves.toBe(2);
      const { wireBytes } = await alice.engine.encryptMessage('conv-1', {
        v: 1,
        type: 'text',
        body: 'welcome carol',
      });
      await expect(carol.engine.processIncoming('conv-1', wireBytes)).resolves.toMatchObject({
        kind: 'application',
        envelope: { body: 'welcome carol' },
      });
    });

    it('sends the snapshot of the epoch the join creates, so the next device can join too', async () => {
      const { api, carol } = await groupWithPublishedSnapshot();

      await carol.engine.joinByExternalCommit('conv-1');

      expect(api.submitMlsExternalJoin).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          deviceId: carol.deviceId,
          epoch: 1,
          groupInfo: expect.any(String),
        }),
      );
    });

    it('refuses a snapshot whose group is not what the server has, before sending anything', async () => {
      const { api, aliceSession, carol } = await groupWithPublishedSnapshot();
      await serveRosterOf(aliceSession, (leaves) => {
        leaves[0]!.userId = 'user-someone-else';
      });
      vi.mocked(api.reportMlsFault).mockResolvedValue({ recorded: true } as never);

      await expect(carol.engine.joinByExternalCommit('conv-1')).rejects.toBeInstanceOf(
        MembershipMismatchError,
      );

      expect(api.submitMlsExternalJoin).not.toHaveBeenCalled();
      await expect(carol.engine.getCurrentEpoch('conv-1')).rejects.toThrow();
    });

    it('saves nothing when another change to the group won first', async () => {
      const { api, carol } = await groupWithPublishedSnapshot();
      vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'conflict' });

      await expect(carol.engine.joinByExternalCommit('conv-1')).resolves.toBe(false);

      await expect(carol.engine.getCurrentEpoch('conv-1')).rejects.toThrow();
    });

    it('recovers a join the server accepted when the tab died before saving', async () => {
      const { aliceSession, carol, submittedCommit } = await groupWithPublishedSnapshot();
      const realSave = carol.storage.save.bind(carol.storage);
      const save = vi
        .spyOn(carol.storage, 'save')
        .mockImplementation(async (key: string, bytes: Uint8Array) => {
          if (key === 'conv-1') throw new Error('tab died');
          return realSave(key, bytes);
        });

      await expect(carol.engine.joinByExternalCommit('conv-1')).rejects.toThrow('tab died');
      save.mockRestore();

      // the members moved on with the accepted join; the roster now has carol
      await aliceSession.process(submittedCommit()!);

      await expect(carol.engine.getCurrentEpoch('conv-1')).resolves.toBe(2);
    });

    describe('a join whose answer was never seen', () => {
      /** carol's join reached the server but the tab died before saving: only the pending records remain. */
      async function crashedJoin() {
        const setup = await groupWithPublishedSnapshot();
        const { carol } = setup;
        const realSave = carol.storage.save.bind(carol.storage);
        const save = vi
          .spyOn(carol.storage, 'save')
          .mockImplementation(async (key: string, bytes: Uint8Array) => {
            if (key === 'conv-1') throw new Error('tab died');
            return realSave(key, bytes);
          });
        await expect(carol.engine.joinByExternalCommit('conv-1')).rejects.toThrow('tab died');
        save.mockRestore();
        return setup;
      }

      it('is finished from the server log when the resubmit fails and the log holds the same bytes', async () => {
        const { api, carol, submittedCommit } = await crashedJoin();
        vi.mocked(api.submitMlsExternalJoin).mockRejectedValue(new Error('server error'));
        vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([
          fakeHandshake({ epoch: 1, senderDeviceId: carol.deviceId, payload: submittedCommit()! }),
        ] as never);

        await expect(carol.engine.getCurrentEpoch('conv-1')).resolves.toBe(2);
      });

      it('is discarded when the resubmit fails and the log does not hold it, so the join starts again from a fresh snapshot', async () => {
        const { api, carol } = await crashedJoin();
        vi.mocked(api.submitMlsExternalJoin).mockRejectedValue(new Error('server error'));
        vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([] as never);

        // the missing group is reported as missing, not as the server error, so recovery can run
        await expect(carol.engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(
          GroupStateUnavailableError,
        );
        vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'accepted' } as never);
        await expect(carol.engine.joinByExternalCommit('conv-1')).resolves.toBe(true);
        await expect(carol.engine.getCurrentEpoch('conv-1')).resolves.toBe(2);
      });

      it('is discarded at once when the server refused the resubmit for good', async () => {
        const { api, carol } = await crashedJoin();
        vi.mocked(api.submitMlsExternalJoin).mockRejectedValue(
          Object.assign(new Error('bad join'), { status: 400 }),
        );

        await expect(carol.engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(
          GroupStateUnavailableError,
        );

        expect(api.getMlsHandshakesSince).not.toHaveBeenCalled();
      });

      it('keeps waiting while the server cannot be reached, without hiding that there is no group', async () => {
        const { api, carol } = await crashedJoin();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.mocked(api.submitMlsExternalJoin).mockRejectedValue(new Error('offline'));
        vi.mocked(api.getMlsHandshakesSince).mockRejectedValue(new Error('offline'));

        await expect(carol.engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(
          GroupStateUnavailableError,
        );

        // the network is back and the server has the join
        vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'duplicate' } as never);
        await expect(carol.engine.getCurrentEpoch('conv-1')).resolves.toBe(2);
      });

      it('is treated as absent when its saved record cannot be read, and the join starts again', async () => {
        const { carol } = await crashedJoin();
        const realLoad = carol.storage.load.bind(carol.storage);
        vi.spyOn(carol.storage, 'load').mockImplementation(async (key: string) => {
          if (key.includes('#pending-join')) throw new UnreadableRecordError('groupSessions', key);
          return realLoad(key);
        });

        await expect(carol.engine.getCurrentEpoch('conv-1')).rejects.toBeInstanceOf(
          GroupStateUnavailableError,
        );
        await expect(carol.engine.joinByExternalCommit('conv-1')).resolves.toBe(true);
        await expect(carol.engine.getCurrentEpoch('conv-1')).resolves.toBe(2);
      });
    });

    it('leaves nothing pending when the join loses the race', async () => {
      const { api, carol } = await groupWithPublishedSnapshot();
      vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'conflict' });

      await expect(carol.engine.joinByExternalCommit('conv-1')).resolves.toBe(false);

      await expect(carol.storage.load('conv-1#pending-join')).resolves.toBeUndefined();
      await expect(carol.storage.load('conv-1#pending-join-request')).resolves.toBeUndefined();
      await expect(carol.engine.getCurrentEpoch('conv-1')).rejects.toThrow();
    });

    it('recovering after a crash adopts its OWN join, not a different device merely sharing the same leaf epoch', async () => {
      // this is the #3 race: another change (e.g. membership work adding the same device via an ordinary
      // Add) could land at the epoch carol's join was also targeting - a leaf-presence check alone cannot
      // tell "my commit won" from "a different commit that happens to add me too won" apart.
      const { aliceSession, carol, submittedCommit } = await groupWithPublishedSnapshot();
      const { api } = await import('../../api');
      const realSave = carol.storage.save.bind(carol.storage);
      const save = vi
        .spyOn(carol.storage, 'save')
        .mockImplementation(async (key: string, bytes: Uint8Array) => {
          if (key === 'conv-1') throw new Error('tab died');
          return realSave(key, bytes);
        });
      await expect(carol.engine.joinByExternalCommit('conv-1')).rejects.toThrow('tab died');
      save.mockRestore();

      // the server tells the truth on resubmit: a DIFFERENT commit won this epoch, not carol's
      vi.mocked(api.submitMlsExternalJoin).mockResolvedValue({ outcome: 'conflict' });
      // the members moved on with whatever else won - carol's own attempted commit was never applied
      await aliceSession.stageCommit({ added: [], removed: [] });
      await aliceSession.commitAccepted();

      await expect(carol.engine.getCurrentEpoch('conv-1')).rejects.toThrow();
      await expect(carol.storage.load('conv-1#pending-join')).resolves.toBeUndefined();
      await expect(carol.storage.load('conv-1#pending-join-request')).resolves.toBeUndefined();
      expect(submittedCommit()).toBeDefined(); // sanity: carol's commit really was built and sent once
    });

    it('does nothing for a group this device already has', async () => {
      const { api, carol } = await groupWithPublishedSnapshot();
      await carol.engine.createGroup('conv-1');

      await expect(carol.engine.joinByExternalCommit('conv-1')).resolves.toBe(false);

      expect(api.getMlsGroupInfo).not.toHaveBeenCalled();
    });

    it('goes through every joinable group, and one that fails does not stop the rest', async () => {
      const { api, carol } = await groupWithPublishedSnapshot();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const publishedSnapshot = await api.getMlsGroupInfo('conv-1', carol.deviceId);
      vi.mocked(api.getMlsJoinableConversations).mockResolvedValue({
        conversationIds: ['conv-broken', 'conv-1'],
      });
      vi.mocked(api.getMlsGroupInfo).mockImplementation(async (conversationId: string) => {
        if (conversationId === 'conv-broken') throw new Error('no snapshot');
        return publishedSnapshot;
      });

      await expect(carol.engine.joinGroupsByItself({ scope: 'full' })).resolves.toEqual(['conv-1']);

      expect(api.getMlsJoinableConversations).toHaveBeenCalledWith(carol.deviceId, {
        scope: 'full',
      });
      expect(warn).toHaveBeenCalledWith(
        'Could not join conv-broken by itself',
        expect.any(Error),
      );
      await expect(carol.engine.getCurrentEpoch('conv-1')).resolves.toBe(2);
    });

    it('reports a join it finished from a crash as done, so the batch tops up key packages once', async () => {
      const { api, carol } = await groupWithPublishedSnapshot();
      const supply = { maybeReplenish: vi.fn().mockResolvedValue(undefined) };
      const engine = new SyncEngine(carol.factory, carol.deviceId, carol.userId, carol.storage, supply);
      const realSave = carol.storage.save.bind(carol.storage);
      const save = vi
        .spyOn(carol.storage, 'save')
        .mockImplementation(async (key: string, bytes: Uint8Array) => {
          if (key === 'conv-1') throw new Error('tab died');
          return realSave(key, bytes);
        });
      await expect(engine.joinByExternalCommit('conv-1')).rejects.toThrow('tab died');
      save.mockRestore();
      vi.mocked(api.getMlsJoinableConversations).mockResolvedValue({ conversationIds: ['conv-1'] });

      await expect(engine.joinGroupsByItself()).resolves.toEqual(['conv-1']);

      expect(supply.maybeReplenish).toHaveBeenCalledWith({ force: true });
      expect(api.submitMlsExternalJoin).toHaveBeenCalledTimes(2);
    });
  });

  describe('a Commit whose answer never arrived (real MLS)', () => {
    type SentCommit = { payload: string; welcome?: { payload: string } };

    async function aliceAddingBob() {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      await alice.engine.createGroup('conv-1');
      const change = { added: [await offerFor(bob)], removed: [] };
      const sent: SentCommit[] = [];
      vi.mocked(api.submitMlsHandshake).mockImplementation(async (_c: string, body: SentCommit) => {
        sent.push(body);
        return { outcome: 'accepted', handshake: fakeHandshake({ epoch: 0, senderDeviceId: 'x', payload: new Uint8Array() }) };
      });
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([] as never);
      const restart = () =>
        new SyncEngine(alice.factory, alice.deviceId, alice.userId, alice.storage);
      return { api, alice, bob, change, sent, restart };
    }

    it('is recognised as applied when the server took it: no refused commit, and the group keeps working', async () => {
      const { api, alice, bob, change, sent, restart } = await aliceAddingBob();
      vi.mocked(api.submitMlsHandshake).mockImplementationOnce(async (_c: string, body: SentCommit) => {
        sent.push(body);
        throw new Error('response lost');
      });

      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow(
        'response lost',
      );
      // the answer to the resubmit is what the server says for bytes it already has
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({ outcome: 'duplicate' } as never);

      const fresh = restart();
      await expect(fresh.syncCommits('conv-1')).resolves.toBe(1);

      expect(fresh.groupProblems.get('conv-1')).toBeUndefined();
      const bobSession = await bob.factory.joinFromWelcome(
        'conv-1',
        base64ToBytes(sent[0]!.welcome!.payload),
      );
      const { wireBytes } = await fresh.encryptMessage('conv-1', {
        v: 1,
        type: 'text',
        body: 'after the lost answer',
      });
      await expect(bobSession.process(wireBytes)).resolves.toMatchObject({
        kind: 'application',
        envelope: { body: 'after the lost answer' },
      });
      // settled for good: another restart has nothing left to resubmit
      const settled = vi.mocked(api.submitMlsHandshake).mock.calls.length;
      await expect(restart().syncCommits('conv-1')).resolves.toBe(1);
      expect(api.submitMlsHandshake).toHaveBeenCalledTimes(settled);
    });

    it('is recovered when the tab died between the server accepting it and the save', async () => {
      const { alice, change, restart } = await aliceAddingBob();
      const realSave = alice.storage.save.bind(alice.storage);
      const save = vi
        .spyOn(alice.storage, 'save')
        .mockImplementation(async (key: string, bytes: Uint8Array) => {
          if (key === 'conv-1') throw new Error('tab died');
          return realSave(key, bytes);
        });
      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow('tab died');
      save.mockRestore();
      const { api } = await import('../../api');
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({ outcome: 'duplicate' } as never);

      await expect(restart().getCurrentEpoch('conv-1')).resolves.toBe(1);
    });

    it('is dropped when the server does not have it, and the group stays at the epoch it was at', async () => {
      const { api, alice, change, restart } = await aliceAddingBob();
      vi.mocked(api.submitMlsHandshake).mockRejectedValue(new Error('rejected'));
      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow('rejected');

      const fresh = restart();
      await expect(fresh.syncCommits('conv-1')).resolves.toBe(0);

      expect(fresh.groupProblems.get('conv-1')).toBeUndefined();
      // nothing left to settle: the next restart neither resubmits nor moves the group
      const settled = vi.mocked(api.submitMlsHandshake).mock.calls.length;
      const next = restart();
      await expect(next.syncCommits('conv-1')).resolves.toBe(0);
      expect(api.submitMlsHandshake).toHaveBeenCalledTimes(settled);
      await expect(
        next.encryptMessage('conv-1', { v: 1, type: 'text', body: 'x' }),
      ).resolves.toMatchObject({ epoch: 0 });
    });

    it('is dropped when another Commit won the epoch first, and the winner is what the group ends up on', async () => {
      const { api, alice, bob, change, restart } = await aliceAddingBob();
      const carol = await setUpDevice('user-carol');
      const winnerSession = await alice.factory.restore('conv-1', (await alice.storage.load('conv-1'))!);
      const winner = await winnerSession.stageCommit({ added: [await offerFor(carol)], removed: [] });
      await winnerSession.commitAccepted();
      await serveRosterOf(winnerSession);
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([
        fakeHandshake({
          epoch: 0,
          senderDeviceId: 'winner',
          payload: winner.wireBytes,
          declared: { addedDevices: [attest(carol)], removedDevices: [] },
        }),
      ] as never);
      vi.mocked(api.submitMlsHandshake).mockRejectedValueOnce(new Error('response lost'));
      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow();
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({ outcome: 'conflict' } as never);

      const fresh = restart();
      await expect(fresh.syncCommits('conv-1')).resolves.toBe(1);

      const users = ((await fresh.listLeaves('conv-1')) ?? []).map((leaf) => leaf.userId);
      expect(users).toContain('user-carol');
      expect(users).not.toContain(bob.userId);
      expect(fresh.groupProblems.get('conv-1')).toBeUndefined();
    });

    it('stays pending while the server cannot be reached, so nothing is decided blind', async () => {
      const { api, alice, change, restart } = await aliceAddingBob();
      vi.mocked(api.submitMlsHandshake).mockRejectedValue(new Error('offline'));
      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow();
      vi.mocked(api.getMlsHandshakesSince).mockRejectedValue(new Error('offline'));

      const back = restart();
      await expect(back.syncCommits('conv-1')).rejects.toThrow('offline');

      // the network returns and the server has the Commit: the unsettled send is still settled
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({ outcome: 'duplicate' } as never);
      vi.mocked(api.getMlsHandshakesSince).mockResolvedValue([] as never);
      await expect(back.syncCommits('conv-1')).resolves.toBe(1);
    });

    it('is not kept when the answer is a lost race: the winner is applied and the record is gone', async () => {
      const { api, alice, change } = await aliceAddingBob();
      const carol = await setUpDevice('user-carol');
      // the winner: another member's Commit adding carol at the same epoch
      const winnerSession = await alice.factory.restore('conv-1', (await alice.storage.load('conv-1'))!);
      const winner = await winnerSession.stageCommit({ added: [await offerFor(carol)], removed: [] });
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({
        outcome: 'conflict',
        handshake: fakeHandshake({
          epoch: 0,
          senderDeviceId: 'winner',
          payload: winner.wireBytes,
          declared: {
            addedDevices: [attest(carol)],
            removedDevices: [],
          },
        }),
      } as never);
      await serveRosterOf(winnerSession);
      await winnerSession.commitAccepted();

      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toBeInstanceOf(
        EpochConflictError,
      );

      await expect(alice.engine.getCurrentEpoch('conv-1')).resolves.toBe(1);
      const settled = vi.mocked(api.submitMlsHandshake).mock.calls.length;
      const other = new SyncEngine(alice.factory, alice.deviceId, alice.userId, alice.storage);
      await expect(other.getCurrentEpoch('conv-1')).resolves.toBe(1);
      expect(api.submitMlsHandshake).toHaveBeenCalledTimes(settled);
    });

    it('does not keep a rejected Commit in memory when handling the lost race fails', async () => {
      const { api, alice, change } = await aliceAddingBob();
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({
        outcome: 'conflict',
        handshake: fakeHandshake({ epoch: 0, senderDeviceId: 'winner', payload: new Uint8Array() }),
      } as never);
      vi.spyOn(alice.factory, 'restore').mockRejectedValueOnce(new Error('restore failed'));

      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow(
        'restore failed',
      );

      // the group is still at the epoch the server has, not at the rejected Commit's
      await expect(
        alice.engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'still epoch 0' }),
      ).resolves.toMatchObject({ epoch: 0 });
    });

    it('is settled by the same engine that sent it, even after it saw no pending Commit', async () => {
      const { api, alice, change } = await aliceAddingBob();
      await alice.engine.getCurrentEpoch('conv-1');
      vi.mocked(api.submitMlsHandshake).mockRejectedValueOnce(new Error('response lost'));
      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow();
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({ outcome: 'duplicate' } as never);

      await expect(alice.engine.syncCommits('conv-1')).resolves.toBe(1);
    });

    it('tells the thread about the member it added, even when it was settled after a crash', async () => {
      const { api, alice, change } = await aliceAddingBob();
      vi.mocked(api.submitMlsHandshake).mockRejectedValueOnce(new Error('response lost'));
      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow();
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({ outcome: 'duplicate' } as never);
      const log = new MembershipEventLog(new InMemoryMembershipEventStorage());
      const fresh = new SyncEngine(
        alice.factory,
        alice.deviceId,
        alice.userId,
        alice.storage,
        undefined,
        log,
      );

      await fresh.syncCommits('conv-1');

      expect(await log.list('conv-1')).toMatchObject([
        { kind: 'joined', userId: 'user-bob', epoch: 1 },
      ]);
    });

    it('settles again on the next open when marking the group as declared fails, instead of losing it', async () => {
      const { api, alice, change, restart } = await aliceAddingBob();
      vi.mocked(api.submitMlsHandshake).mockRejectedValueOnce(new Error('response lost'));
      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow();
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({ outcome: 'duplicate' } as never);
      const mark = vi
        .spyOn(CommitVerifier.prototype, 'markDeclaredSeen')
        .mockRejectedValueOnce(new Error('disk full'));
      const fresh = restart();

      await expect(fresh.syncCommits('conv-1')).rejects.toThrow('disk full');
      await expect(fresh.syncCommits('conv-1')).resolves.toBe(1);

      // the marker was written on the retry, not skipped because the record looked finished
      expect(mark).toHaveBeenCalledTimes(2);
      mark.mockRestore();
    });

    it('is not resubmitted after the server refused it for good', async () => {
      const { api, alice, change, restart } = await aliceAddingBob();
      vi.mocked(api.submitMlsHandshake).mockRejectedValueOnce(
        Object.assign(new Error('bad commit'), { status: 422 }),
      );
      await expect(alice.engine.submitMembershipChange('conv-1', change)).rejects.toThrow(
        'bad commit',
      );
      const before = vi.mocked(api.submitMlsHandshake).mock.calls.length;

      await expect(restart().syncCommits('conv-1')).resolves.toBe(0);

      expect(api.submitMlsHandshake).toHaveBeenCalledTimes(before);
    });

    it('does not stop a read when the server cannot be reached to settle it', async () => {
      const { api, alice, bob, restart } = await aliceAddingBob();
      const carol = await setUpDevice('user-carol');
      const change = { added: [await offerFor(carol)], removed: [] };
      // bob is in at epoch 1 and sends a message at that epoch
      const aliceSession = await alice.engine.createGroup('conv-2');
      const added = await aliceSession.stageCommit({ added: [await offerFor(bob)], removed: [] });
      await aliceSession.commitAccepted();
      await alice.storage.save('conv-2', await aliceSession.serialize());
      const bobSession = await bob.factory.joinFromWelcome('conv-2', added.welcome!.welcomeBytes);
      const message = await bobSession.encrypt({ v: 1, type: 'text', body: 'hello alice' });
      // alice sends a Commit whose answer is lost while the network is down
      vi.mocked(api.submitMlsHandshake).mockRejectedValue(new Error('offline'));
      vi.mocked(api.getMlsHandshakesSince).mockRejectedValue(new Error('offline'));
      await expect(alice.engine.submitMembershipChange('conv-2', change)).rejects.toThrow('offline');
      const offline = restart();

      await expect(offline.processIncoming('conv-2', message)).resolves.toMatchObject({
        kind: 'application',
        envelope: { body: 'hello alice' },
      });
      // a write still needs the earlier send settled
      await expect(
        offline.encryptMessage('conv-2', { v: 1, type: 'text', body: 'x' }),
      ).rejects.toThrow('offline');
    });
  });

  describe('a Commit that arrives outside catch-up (real MLS)', () => {
    it('is refused and reported like any other refused Commit, and the saved epoch is kept', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const aliceSession = await alice.engine.createGroup('conv-1');
      const addBob = await aliceSession.stageCommit({ added: [await offerFor(bob)], removed: [] });
      await aliceSession.commitAccepted();
      const bobSession = await bob.factory.joinFromWelcome('conv-1', addBob.welcome!.welcomeBytes);
      await saveSession(bob, bobSession);
      const next = await aliceSession.stageCommit({ added: [], removed: [] });
      vi.mocked(api.reportMlsFault).mockResolvedValue({ recorded: true } as never);

      await expect(bob.engine.processIncoming('conv-1', next.wireBytes)).rejects.toBeInstanceOf(
        MembershipMismatchError,
      );

      expect(api.reportMlsFault).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ deviceId: bob.deviceId, epoch: 1 }),
      );
      expect(bob.engine.groupProblems.get('conv-1')).toEqual({ kind: 'refused-commit' });
      await expect(bob.engine.getCurrentEpoch('conv-1')).resolves.toBe(1);
    });
  });

  describe('the cross-tab reload', () => {
    it('does not reload the saved session for every operation - only when another tab wrote a newer one', async () => {
      const alice = await setUpDevice('user-alice');
      await alice.engine.createGroup('conv-1');
      const restore = vi.spyOn(alice.factory, 'restore');

      await alice.engine.getCurrentEpoch('conv-1');
      await alice.engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'a' });
      await alice.engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'b' });

      expect(restore).not.toHaveBeenCalled();
    });

    it('reloads once after another tab wrote, then keeps the fresh copy', async () => {
      const alice = await setUpDevice('user-alice');
      await alice.engine.createGroup('conv-1');
      const otherTab = new SyncEngine(alice.factory, alice.deviceId, alice.userId, alice.storage);
      await otherTab.encryptMessage('conv-1', { v: 1, type: 'text', body: 'from the other tab' });
      const restore = vi.spyOn(alice.factory, 'restore');

      await alice.engine.getCurrentEpoch('conv-1');
      await alice.engine.getCurrentEpoch('conv-1');

      expect(restore).toHaveBeenCalledTimes(1);
    });
  });

  describe('a message you send from one device', () => {
    it('is readable on your other device, but not on the device that sent it', async () => {
      const phone = await setUpDevice('user-mai');
      const laptop = await setUpDevice('user-mai');
      const phoneSession = await phone.engine.createGroup('conv-1');
      const added = await phoneSession.stageCommit({
        added: [await offerFor(laptop)],
        removed: [],
      });
      await phoneSession.commitAccepted();
      const laptopSession = await laptop.factory.joinFromWelcome(
        'conv-1',
        added.welcome!.welcomeBytes,
      );
      await saveSession(phone, phoneSession);

      const { wireBytes } = await phone.engine.encryptMessage('conv-1', {
        v: 1,
        type: 'text',
        body: 'from my phone',
      });

      await expect(laptopSession.process(wireBytes)).resolves.toMatchObject({
        kind: 'application',
        envelope: { body: 'from my phone' },
      });
      await expect(phoneSession.process(wireBytes)).rejects.toThrow();
    });
  });

  describe('two tabs of one device', () => {
    it('never reuse a message key, because each reloads the saved session before it encrypts', async () => {
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      const aliceSession = await alice.engine.createGroup('conv-1');
      const addBob = await aliceSession.stageCommit({
        added: [await offerFor(bob)],
        removed: [],
      });
      await aliceSession.commitAccepted();
      await saveSession(alice, aliceSession);
      const bobSession = await bob.factory.joinFromWelcome(
        'conv-1',
        addBob.welcome!.welcomeBytes,
      );
      // a second tab: its own engine and memory, the same saved state
      const otherTab = new SyncEngine(alice.factory, alice.deviceId, alice.userId, alice.storage);

      // the other tab has already opened the conversation, so it holds an older copy in memory
      await otherTab.getCurrentEpoch('conv-1');

      const first = await alice.engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'a' });
      const second = await otherTab.encryptMessage('conv-1', { v: 1, type: 'text', body: 'b' });

      await expect(bobSession.process(first.wireBytes)).resolves.toMatchObject({
        kind: 'application',
      });
      await expect(bobSession.process(second.wireBytes)).resolves.toMatchObject({
        kind: 'application',
      });
    });
  });

  describe('forgetConversation', () => {
    it('clears the cached session and deletes persisted state', async () => {
      const alice = await setUpDevice('user-alice');
      const storage = new InMemoryGroupSessionStorage();
      const engine = new SyncEngine(alice.factory, alice.deviceId, alice.userId, storage);
      await engine.createGroup('conv-1');

      await engine.forgetConversation('conv-1');

      await expect(storage.load('conv-1')).resolves.toBeUndefined();
      await expect(engine.syncCommits('conv-1')).rejects.toThrow(GroupStateUnavailableError);
    });
  });

  describe('runExclusive ordering', () => {
    it('serializes concurrent operations on the same conversation', async () => {
      const alice = await setUpDevice('user-alice');
      await alice.engine.createGroup('conv-1');

      const results = await Promise.all([
        alice.engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'first' }),
        alice.engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'second' }),
        alice.engine.encryptMessage('conv-1', { v: 1, type: 'text', body: 'third' }),
      ]);

      // If these ran concurrently against the same mutable ClientState,
      // ts-mls would either throw or silently corrupt the ratchet - getting
      // 3 distinct, valid ciphertexts back is the real assertion here.
      expect(new Set(results.map((r) => bytesToBase64(r.wireBytes))).size).toBe(3);
      await expect(alice.engine.getCurrentEpoch('conv-1')).resolves.toBe(0);
    });
  });
});
