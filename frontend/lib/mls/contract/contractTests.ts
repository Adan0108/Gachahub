import { describe, expect, it } from 'vitest';
import type {
  DeviceIdentityStore,
  GroupSession,
  GroupSessionFactory,
} from './client';
import type { DeviceCredential, KeyPackageOffer } from './types';
import { CredentialMismatchError } from './errors';

/**
 * The step 2 bake-off entry point: implement this once per candidate
 * library (ts-mls, OpenMLS-WASM, ...) as a thin adapter, then call
 * runMlsClientContractTests(candidate) from that candidate's own test file.
 * The winner is whichever candidate actually passes this suite, not
 * whichever compiles first (critique C2).
 */
export interface MlsClientCandidate {
  name: string;
  /** A fresh, independent store per call - each call simulates a distinct browser device. */
  createDeviceIdentityStore(): DeviceIdentityStore;
  createGroupSessionFactory(store: DeviceIdentityStore): GroupSessionFactory;
}

interface SimulatedDevice {
  store: DeviceIdentityStore;
  factory: GroupSessionFactory;
  credential: DeviceCredential;
}

async function setUpDevice(
  candidate: MlsClientCandidate,
  userId: string,
): Promise<SimulatedDevice> {
  const store = candidate.createDeviceIdentityStore();
  await store.provision(userId);
  const credential = await store.getOwnCredential();
  const factory = candidate.createGroupSessionFactory(store);
  return { store, factory, credential };
}

async function offerKeyPackage(
  device: SimulatedDevice,
): Promise<KeyPackageOffer> {
  const keyPackages = await device.store.generateKeyPackages(1);
  const keyPackage = keyPackages[0];
  if (!keyPackage) {
    throw new Error('generateKeyPackages(1) returned no key packages');
  }
  return { credential: device.credential, keyPackage };
}

/** Adds one device to a group the caller already controls (already a member/creator). */
async function addDevice(
  group: GroupSession,
  newDevice: SimulatedDevice,
  conversationId: string,
): Promise<GroupSession> {
  const { wireBytes, welcomes } = await group.stageCommit({
    added: [await offerKeyPackage(newDevice)],
    removed: [],
  });
  await group.commitAccepted();

  const welcome = welcomes.find(
    (item) => item.deviceId === newDevice.credential.deviceId,
  );
  if (!welcome) {
    throw new Error('stageCommit did not return a Welcome for the added device');
  }

  return newDevice.factory.joinFromWelcome(conversationId, welcome.welcomeBytes);
}

export function runMlsClientContractTests(candidate: MlsClientCandidate) {
  const conversationId = 'conversation-1';

  describe(`MlsClient contract: ${candidate.name}`, () => {
    // A device's identity is only meaningful for pinning/safety-number
    // verification if it's actually stable - an implementation that mints a
    // fresh signing key per key package would make every "device" look like
    // a different one each time, defeating the point of DeviceCredential.
    it("reports a stable credential across multiple key packages", async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const before = await alice.store.getOwnCredential();

      await alice.store.generateKeyPackages(3);

      const after = await alice.store.getOwnCredential();
      expect(after.signatureKey).toEqual(before.signatureKey);
      expect(after.deviceId).toBe(before.deviceId);
    });

    it('supports 3+ members exchanging application messages', async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const bob = await setUpDevice(candidate, 'user-bob');
      const carol = await setUpDevice(candidate, 'user-carol');

      const aliceGroup = await alice.factory.create(conversationId);
      const bobGroup = await addDevice(aliceGroup, bob, conversationId);

      // Bob must process the Commit that added Carol before decrypting
      // anything sent after that epoch - he's an existing member now, not
      // just a bystander.
      const { wireBytes: addCarolWire, welcomes } = await aliceGroup.stageCommit({
        added: [await offerKeyPackage(carol)],
        removed: [],
      });
      await aliceGroup.commitAccepted();
      await bobGroup.process(addCarolWire);
      const carolWelcome = welcomes.find(
        (item) => item.deviceId === carol.credential.deviceId,
      );
      if (!carolWelcome) {
        throw new Error('missing Carol Welcome');
      }
      const carolGroup = await carol.factory.joinFromWelcome(
        conversationId,
        carolWelcome.welcomeBytes,
      );

      const wire = await aliceGroup.encrypt({
        v: 1,
        type: 'text',
        body: 'hello from alice',
      });

      const bobResult = await bobGroup.process(wire);
      const carolResult = await carolGroup.process(wire);

      expect(bobResult.kind).toBe('application');
      expect(carolResult.kind).toBe('application');
      if (bobResult.kind === 'application' && carolResult.kind === 'application') {
        expect(bobResult.senderDeviceId).toBe(alice.credential.deviceId);
        expect(bobResult.envelope.body).toBe('hello from alice');
        expect(carolResult.envelope.body).toBe('hello from alice');
      }
    });

    it("prevents a removed member from decrypting the next epoch's messages", async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const bob = await setUpDevice(candidate, 'user-bob');

      const aliceGroup = await alice.factory.create(conversationId);
      const bobGroup = await addDevice(aliceGroup, bob, conversationId);

      const { wireBytes: removeBobWire } = await aliceGroup.stageCommit({
        added: [],
        removed: [bob.credential],
      });
      await aliceGroup.commitAccepted();

      // Bob's own client processing his own removal is a real scenario
      // (his other device, or a delayed delivery before he's fully cut
      // off) - it must not throw, just reflect that he's out.
      const bobRemovalResult = await bobGroup.process(removeBobWire);
      expect(bobRemovalResult.kind).toBe('commit');

      const wireAfterRemoval = await aliceGroup.encrypt({
        v: 1,
        type: 'text',
        body: 'bob should never see this',
      });

      await expect(bobGroup.process(wireAfterRemoval)).rejects.toThrow();
    });

    describe("membershipChange on a processed commit", () => {
      it("reports the devices a commit added", async () => {
        const alice = await setUpDevice(candidate, "user-alice");
        const bob = await setUpDevice(candidate, "user-bob");
        const carol = await setUpDevice(candidate, "user-carol");

        const aliceGroup = await alice.factory.create(conversationId);
        const bobGroup = await addDevice(aliceGroup, bob, conversationId);

        const { wireBytes } = await aliceGroup.stageCommit({
          added: [await offerKeyPackage(carol)],
          removed: [],
        });
        await aliceGroup.commitAccepted();

        const result = await bobGroup.process(wireBytes);

        expect(result.kind).toBe("commit");
        if (result.kind === "commit") {
          expect(result.membershipChange?.removed).toEqual([]);
          expect(result.membershipChange?.added).toEqual([carol.credential]);
        }
      });

      it("reports the devices a commit removed", async () => {
        const alice = await setUpDevice(candidate, "user-alice");
        const bob = await setUpDevice(candidate, "user-bob");
        const carol = await setUpDevice(candidate, "user-carol");

        const aliceGroup = await alice.factory.create(conversationId);
        const bobGroup = await addDevice(aliceGroup, bob, conversationId);
        const { wireBytes: addCarolWire, welcomes } = await aliceGroup.stageCommit({
          added: [await offerKeyPackage(carol)],
          removed: [],
        });
        await aliceGroup.commitAccepted();
        await bobGroup.process(addCarolWire);
        await carol.factory.joinFromWelcome(conversationId, welcomes[0]!.welcomeBytes);

        const { wireBytes } = await aliceGroup.stageCommit({
          added: [],
          removed: [carol.credential],
        });
        await aliceGroup.commitAccepted();

        const result = await bobGroup.process(wireBytes);

        expect(result.kind).toBe("commit");
        if (result.kind === "commit") {
          expect(result.membershipChange?.added).toEqual([]);
          expect(result.membershipChange?.removed).toEqual([carol.credential]);
        }
      });

      it("reports adds and removes from one commit together", async () => {
        const alice = await setUpDevice(candidate, "user-alice");
        const bob = await setUpDevice(candidate, "user-bob");
        const carol = await setUpDevice(candidate, "user-carol");
        const dave = await setUpDevice(candidate, "user-dave");

        const aliceGroup = await alice.factory.create(conversationId);
        const bobGroup = await addDevice(aliceGroup, bob, conversationId);
        const { wireBytes: addCarolWire, welcomes } = await aliceGroup.stageCommit({
          added: [await offerKeyPackage(carol)],
          removed: [],
        });
        await aliceGroup.commitAccepted();
        await bobGroup.process(addCarolWire);
        await carol.factory.joinFromWelcome(conversationId, welcomes[0]!.welcomeBytes);

        const { wireBytes } = await aliceGroup.stageCommit({
          added: [await offerKeyPackage(dave)],
          removed: [carol.credential],
        });
        await aliceGroup.commitAccepted();

        const result = await bobGroup.process(wireBytes);

        expect(result.kind).toBe("commit");
        if (result.kind === "commit") {
          expect(result.membershipChange?.added).toEqual([dave.credential]);
          expect(result.membershipChange?.removed).toEqual([carol.credential]);
        }
      });

      it("reports every device when one commit removes several", async () => {
        const alice = await setUpDevice(candidate, "user-alice");
        const bob = await setUpDevice(candidate, "user-bob");
        const carol = await setUpDevice(candidate, "user-carol");
        const dave = await setUpDevice(candidate, "user-dave");

        const aliceGroup = await alice.factory.create(conversationId);
        const bobGroup = await addDevice(aliceGroup, bob, conversationId);
        const { wireBytes: addWire, welcomes } = await aliceGroup.stageCommit({
          added: [await offerKeyPackage(carol), await offerKeyPackage(dave)],
          removed: [],
        });
        await aliceGroup.commitAccepted();
        await bobGroup.process(addWire);
        expect(welcomes).toHaveLength(2);

        const { wireBytes } = await aliceGroup.stageCommit({
          added: [],
          removed: [carol.credential, dave.credential],
        });
        await aliceGroup.commitAccepted();

        const result = await bobGroup.process(wireBytes);

        expect(result.kind).toBe("commit");
        if (result.kind === "commit") {
          expect(result.membershipChange?.removed).toHaveLength(2);
          expect(result.membershipChange?.removed).toEqual(
            expect.arrayContaining([carol.credential, dave.credential]),
          );
        }
      });
    });

    it('resolves concurrent commits: the losing device gets rejected and recovers', async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const bob = await setUpDevice(candidate, 'user-bob');
      const carol = await setUpDevice(candidate, 'user-carol');
      const dave = await setUpDevice(candidate, 'user-dave');

      const aliceGroup = await alice.factory.create(conversationId);
      const bobGroup = await addDevice(aliceGroup, bob, conversationId);

      // Alice and Bob both try to add someone in the same epoch - only one
      // commit can win per epoch (ChatConversation.mlsEpoch compare-and-set
      // on the backend, simulated here as "whoever calls commitAccepted
      // first for this epoch wins").
      const aliceAttempt = await aliceGroup.stageCommit({
        added: [await offerKeyPackage(carol)],
        removed: [],
      });
      const bobAttempt = await bobGroup.stageCommit({
        added: [await offerKeyPackage(dave)],
        removed: [],
      });

      expect(aliceAttempt.expectedEpoch).toBe(bobAttempt.expectedEpoch);

      // Alice's commit wins the race.
      await aliceGroup.commitAccepted();

      // Bob's loses - his client must discard the staged commit cleanly,
      // then catch up on the winning one.
      await bobGroup.commitRejected();
      const bobCatchUp = await bobGroup.process(aliceAttempt.wireBytes);
      expect(bobCatchUp.kind).toBe('commit');

      const epochAfter = await bobGroup.currentEpoch();
      expect(epochAfter).toBe(aliceAttempt.expectedEpoch + 1);

      // Bob is free to retry his own proposal against the new epoch.
      const retry = await bobGroup.stageCommit({
        added: [await offerKeyPackage(dave)],
        removed: [],
      });
      expect(retry.expectedEpoch).toBe(epochAfter);
    });

    it('lets an offline member catch up across 3+ epochs', async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const bob = await setUpDevice(candidate, 'user-bob');
      const carol = await setUpDevice(candidate, 'user-carol');
      const dave = await setUpDevice(candidate, 'user-dave');

      const aliceGroup = await alice.factory.create(conversationId);
      const bobGroup = await addDevice(aliceGroup, bob, conversationId);

      // Bob goes offline from here - he never processes the next 2 epochs
      // until the very end, in one batch, oldest first.
      const missedWire: Uint8Array[] = [];

      const addCarol = await aliceGroup.stageCommit({
        added: [await offerKeyPackage(carol)],
        removed: [],
      });
      await aliceGroup.commitAccepted();
      missedWire.push(addCarol.wireBytes);

      const addDave = await aliceGroup.stageCommit({
        added: [await offerKeyPackage(dave)],
        removed: [],
      });
      await aliceGroup.commitAccepted();
      missedWire.push(addDave.wireBytes);

      const message = await aliceGroup.encrypt({
        v: 1,
        type: 'text',
        body: 'catch up on this',
      });
      missedWire.push(message);

      for (const wireBytes of missedWire) {
        // eslint-disable-next-line no-await-in-loop -- must process oldest first, in order
        await bobGroup.process(wireBytes);
      }

      const finalResult = await bobGroup.process(
        await aliceGroup.encrypt({ v: 1, type: 'text', body: 'are we in sync?' }),
      );
      expect(finalResult.kind).toBe('application');
    });

    it('serializes and restores session state (save, reload, continue)', async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const bob = await setUpDevice(candidate, 'user-bob');

      const aliceGroup = await alice.factory.create(conversationId);
      const bobGroup = await addDevice(aliceGroup, bob, conversationId);

      const serialized = await bobGroup.serialize();
      const restored = await bob.factory.restore(conversationId, serialized);

      const wire = await aliceGroup.encrypt({
        v: 1,
        type: 'text',
        body: 'after reload',
      });
      const result = await restored.process(wire);

      expect(result.kind).toBe('application');
      if (result.kind === 'application') {
        expect(result.envelope.body).toBe('after reload');
      }
    });

    it('processes out-of-order messages within the same epoch', async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const bob = await setUpDevice(candidate, 'user-bob');

      const aliceGroup = await alice.factory.create(conversationId);
      const bobGroup = await addDevice(aliceGroup, bob, conversationId);

      const first = await aliceGroup.encrypt({ v: 1, type: 'text', body: 'first' });
      const second = await aliceGroup.encrypt({ v: 1, type: 'text', body: 'second' });

      // second arrives before first - a real possibility over an
      // unordered transport within a single epoch (no commit in between).
      const secondResult = await bobGroup.process(second);
      const firstResult = await bobGroup.process(first);

      expect(secondResult.kind).toBe('application');
      expect(firstResult.kind).toBe('application');
      if (secondResult.kind === 'application' && firstResult.kind === 'application') {
        expect(secondResult.envelope.body).toBe('second');
        expect(firstResult.envelope.body).toBe('first');
      }
    });

    it('rejects a credential that does not match the claimed userId/deviceId', async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const mallory = await setUpDevice(candidate, 'user-mallory');

      const aliceGroup = await alice.factory.create(conversationId);

      const forgedOffer = await offerKeyPackage(mallory);
      forgedOffer.credential = {
        ...forgedOffer.credential,
        userId: 'user-bob', // claims to be Bob, key package actually belongs to Mallory
      };

      await expect(
        aliceGroup.stageCommit({ added: [forgedOffer], removed: [] }),
      ).rejects.toThrow(CredentialMismatchError);
    });

    it('rejects a Welcome addressed to a different device', async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const bob = await setUpDevice(candidate, 'user-bob');
      const mallory = await setUpDevice(candidate, 'user-mallory');

      const aliceGroup = await alice.factory.create(conversationId);
      const { welcomes } = await aliceGroup.stageCommit({
        added: [await offerKeyPackage(bob)],
        removed: [],
      });
      await aliceGroup.commitAccepted();

      const bobWelcome = welcomes.find(
        (item) => item.deviceId === bob.credential.deviceId,
      );
      if (!bobWelcome) {
        throw new Error('missing Bob Welcome');
      }

      await expect(
        mallory.factory.joinFromWelcome(conversationId, bobWelcome.welcomeBytes),
      ).rejects.toThrow(CredentialMismatchError);
    });

    it("rejects a Welcome whose group_id does not match the conversation it's delivered for", async () => {
      const alice = await setUpDevice(candidate, 'user-alice');
      const bob = await setUpDevice(candidate, 'user-bob');

      const aliceGroup = await alice.factory.create(conversationId);
      const { welcomes } = await aliceGroup.stageCommit({
        added: [await offerKeyPackage(bob)],
        removed: [],
      });
      await aliceGroup.commitAccepted();

      const bobWelcome = welcomes.find(
        (item) => item.deviceId === bob.credential.deviceId,
      );
      if (!bobWelcome) {
        throw new Error('missing Bob Welcome');
      }

      // A server bug or attacker relabels which conversation this Welcome
      // is delivered for - the client must catch the mismatch itself
      // rather than trusting the server's routing.
      await expect(
        bob.factory.joinFromWelcome('a-different-conversation', bobWelcome.welcomeBytes),
      ).rejects.toThrow(CredentialMismatchError);
    });
  });
}
