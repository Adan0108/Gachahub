import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from './syncEngine';
import { TsMlsDeviceIdentityStore, TsMlsGroupSessionFactory } from '../adapter/tsMlsAdapter';
import { InMemoryGroupSessionStorage } from '../storage/groupSessionStorage';
import { bytesToBase64, base64ToBytes } from '../storage/base64';
import { EpochConflictError, GroupStateUnavailableError } from '../contract/errors';
import type { DeviceCredential, KeyPackageOffer } from '../contract/types';

vi.mock('../../api', () => ({
  api: {
    claimChatDeviceKeyPackage: vi.fn(),
    submitMlsHandshake: vi.fn(),
    getMlsHandshakesSince: vi.fn(),
    getMlsPendingWelcomes: vi.fn(),
    consumeMlsWelcome: vi.fn(),
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
  const engine = new SyncEngine(factory, credential.deviceId, new InMemoryGroupSessionStorage());
  return { store, factory, engine, deviceId: credential.deviceId, userId, credential };
}

/** Builds a claimChatDeviceKeyPackage-shaped response from a real key package `device` just generated. */
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

function fakeHandshake(overrides: {
  epoch: number;
  senderDeviceId: string;
  payload: Uint8Array;
}) {
  return {
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

  describe('addUserToConversation', () => {
    it('claims a key package, stages a commit, and submits it', async () => {
      const { api } = await import('../../api');
      const alice = await setUpDevice('user-alice');
      const bob = await setUpDevice('user-bob');
      await alice.engine.createGroup('conv-1');

      vi.mocked(api.claimChatDeviceKeyPackage).mockResolvedValue(await claimResponseFor(bob));
      vi.mocked(api.submitMlsHandshake).mockImplementation(async (_conversationId, payload) => ({
        outcome: 'accepted',
        handshake: fakeHandshake({
          epoch: payload.epoch,
          senderDeviceId: payload.deviceId,
          payload: base64ToBytes(payload.payload),
        }),
      }));

      const epoch = await alice.engine.addUserToConversation('conv-1', 'user-bob');

      expect(epoch).toBe(1);
      expect(api.claimChatDeviceKeyPackage).toHaveBeenCalledWith('user-bob');
      expect(api.submitMlsHandshake).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          deviceId: alice.deviceId,
          epoch: 0,
          welcomes: [expect.objectContaining({ recipientDeviceId: bob.deviceId })],
        }),
      );
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
      const bobEngine = new SyncEngine(bob.factory, bob.deviceId, bobStorage);

      // Alice wins the race for epoch 1 by adding dave...
      const addDave = await aliceSession.stageCommit({
        added: [await offerFor(dave)],
        removed: [],
      });
      await aliceSession.commitAccepted();

      // ...while bob, also at epoch 1, tries to add carol and loses.
      vi.mocked(api.claimChatDeviceKeyPackage).mockResolvedValue(await claimResponseFor(carol));
      vi.mocked(api.submitMlsHandshake).mockResolvedValue({
        outcome: 'conflict',
        handshake: fakeHandshake({
          epoch: 1,
          senderDeviceId: alice.deviceId,
          payload: addDave.wireBytes,
        }),
      });

      await expect(
        bobEngine.addUserToConversation('conv-1', 'user-carol'),
      ).rejects.toThrow(EpochConflictError);

      // Bob's session should now be caught up on alice's winning commit.
      await expect(bobEngine.getCurrentEpoch('conv-1')).resolves.toBe(2);
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
      const bobEngine = new SyncEngine(bob.factory, bob.deviceId, bobStorage);

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
      const engine = new SyncEngine(alice.factory, alice.deviceId, storage);
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
      const engine = new SyncEngine(alice.factory, alice.deviceId, storage);
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
      expect(new Set(results.map((r) => bytesToBase64(r))).size).toBe(3);
      await expect(alice.engine.getCurrentEpoch('conv-1')).resolves.toBe(0);
    });
  });
});
