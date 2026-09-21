import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from './syncEngine';
import { TsMlsDeviceIdentityStore, TsMlsGroupSessionFactory } from '../adapter/tsMlsAdapter';
import { InMemoryGroupSessionStorage } from '../storage/groupSessionStorage';
import { bytesToBase64, base64ToBytes } from '../storage/base64';
import {
  EpochConflictError,
  GroupStateUnavailableError,
  MembershipMismatchError,
} from '../contract/errors';
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
    revokeChatDevice: vi.fn(),
  },
}));

interface Device {
  store: TsMlsDeviceIdentityStore;
  factory: TsMlsGroupSessionFactory;
  engine: SyncEngine;
  deviceId: string;
  userId: string;
  credential: DeviceCredential;
}

async function setUpDevice(userId: string): Promise<Device> {
  const store = new TsMlsDeviceIdentityStore();
  const credential = await store.provision(userId);
  const factory = new TsMlsGroupSessionFactory(store);
  const engine = new SyncEngine(
    factory,
    credential.deviceId,
    userId,
    new InMemoryGroupSessionStorage(),
  );
  return { store, factory, engine, deviceId: credential.deviceId, userId, credential };
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
          welcomes: [expect.objectContaining({ recipientDeviceId: bob.deviceId })],
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
        submitted.welcomes
          .map((welcome: { recipientDeviceId: string }) => welcome.recipientDeviceId)
          .sort(),
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
      const bobWelcome = addBob.welcomes.find((w) => w.deviceId === bob.deviceId);
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
          welcomes: [],
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
        addBob.welcomes.find((w) => w.deviceId === bob.deviceId)!.welcomeBytes,
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
      const welcomeFor = (deviceId: string) =>
        added.welcomes.find((w) => w.deviceId === deviceId)!.welcomeBytes;
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
        base64ToBytes(submitted.welcomes[0]!.payload),
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

  describe('revokeOtherDevice', () => {
    it('revokes the device, then looks for leftover devices in full straight away', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const order: string[] = [];
      vi.mocked(api.revokeChatDevice).mockImplementation(async () => {
        order.push('revoke');
      });
      vi.mocked(api.getMlsMembershipWork).mockImplementation(
        async (_device: string, options: { scope?: string } = {}) => {
          order.push(`work:${options.scope}`);
          return { items: [], nextCursor: null };
        },
      );

      await alice.engine.revokeOtherDevice('old-phone');

      expect(api.revokeChatDevice).toHaveBeenCalledWith('old-phone');
      expect(order).toEqual(['revoke', 'work:full']);
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
      const bobWelcome = addBob.welcomes.find((w) => w.deviceId === bob.deviceId);
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
      const bobWelcome = addBob.welcomes.find((w) => w.deviceId === bob.deviceId);
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
            addBob.welcomes.find((w) => w.deviceId === bob.deviceId)!.welcomeBytes,
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
            addBob.welcomes.find((w) => w.deviceId === bob.deviceId)!.welcomeBytes,
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
      await expect(bob.engine.getCurrentEpoch('conv-1')).resolves.toBe(1);

      vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([
        {
          id: 'welcome-stale',
          conversationId: 'conv-1',
          // Never actually decoded - hasSession() must short-circuit
          // before joinFromWelcome is ever attempted on this garbage.
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

      expect(saveSpy).toHaveBeenCalledTimes(2);
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
