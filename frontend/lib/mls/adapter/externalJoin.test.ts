import { describe, expect, it } from 'vitest';
import { TsMlsDeviceIdentityStore, TsMlsGroupSessionFactory } from './tsMlsAdapter';
import { CredentialMismatchError } from '../contract/errors';
import type { GroupSession } from '../contract/client';

const CONVERSATION = 'conv-1';

async function newDevice(userId: string) {
  const store = new TsMlsDeviceIdentityStore();
  const credential = await store.provision(userId);
  return { store, credential, factory: new TsMlsGroupSessionFactory(store) };
}

async function offerFor(device: Awaited<ReturnType<typeof newDevice>>) {
  const [keyPackage] = await device.store.generateKeyPackages(1);
  return { credential: device.credential, keyPackage: keyPackage! };
}

/** alice and bob are in a group; the last commit's GroupInfo is what a newcomer would fetch. */
async function groupOfTwo() {
  const alice = await newDevice('user-alice');
  const bob = await newDevice('user-bob');
  const aliceSession = await alice.factory.create(CONVERSATION);
  const staged = await aliceSession.stageCommit({ added: [await offerFor(bob)], removed: [] });
  await aliceSession.commitAccepted();
  const bobSession = await bob.factory.joinFromWelcome(
    CONVERSATION,
    staged.welcome!.welcomeBytes,
  );
  return { alice, bob, aliceSession, bobSession, groupInfo: staged.groupInfo };
}

const text = (body: string) => ({ v: 1 as const, type: 'text' as const, body });

async function read(session: GroupSession, wire: Uint8Array) {
  const result = await session.process(wire);
  return result.kind === 'application' ? result.envelope : result;
}

describe('joining a group by external commit', () => {
  it('lets a new device join with no member taking part, and every member follows', async () => {
    const { aliceSession, bobSession, groupInfo } = await groupOfTwo();
    const carol = await newDevice('user-carol');

    const joined = await carol.factory.joinExternally(CONVERSATION, groupInfo);

    // the members process the joiner's public commit and land on the same epoch
    const seenByAlice = await aliceSession.process(joined.commitBytes);
    const seenByBob = await bobSession.process(joined.commitBytes);
    expect(seenByAlice).toMatchObject({ kind: 'commit', epoch: 2 });
    expect(seenByBob).toMatchObject({ kind: 'commit', epoch: 2 });
    if (seenByAlice.kind !== 'commit' || !seenByAlice.membershipChange) {
      throw new Error('expected a commit');
    }
    expect(seenByAlice.membershipChange.added).toEqual([
      expect.objectContaining({ userId: 'user-carol', deviceId: carol.credential.deviceId }),
    ]);
    expect(seenByAlice.membershipChange.removed).toEqual([]);
    await expect(joined.session.currentEpoch()).resolves.toBe(2);

    // and they can all talk to each other
    expect(await read(joined.session, await aliceSession.encrypt(text('hi carol')))).toMatchObject({
      body: 'hi carol',
    });
    expect(await read(bobSession, await joined.session.encrypt(text('hi all')))).toMatchObject({
      body: 'hi all',
    });
  });

  it('publishes a GroupInfo for the epoch the join creates, so the next device can join too', async () => {
    const { aliceSession, bobSession, groupInfo } = await groupOfTwo();
    const carol = await newDevice('user-carol');
    const joined = await carol.factory.joinExternally(CONVERSATION, groupInfo);
    await aliceSession.process(joined.commitBytes);
    await bobSession.process(joined.commitBytes);

    const dave = await newDevice('user-dave');
    const daveJoined = await dave.factory.joinExternally(CONVERSATION, joined.groupInfoBytes);

    await expect(aliceSession.process(daveJoined.commitBytes)).resolves.toMatchObject({
      kind: 'commit',
      epoch: 3,
    });
  });

  it('reports the epoch of a public commit without processing it', async () => {
    const { aliceSession, groupInfo } = await groupOfTwo();
    const carol = await newDevice('user-carol');
    const joined = await carol.factory.joinExternally(CONVERSATION, groupInfo);

    await expect(aliceSession.peekEpoch(joined.commitBytes)).resolves.toBe(1);
    await expect(aliceSession.currentEpoch()).resolves.toBe(1);
  });

  it('refuses a GroupInfo for another conversation, or bytes that are not one', async () => {
    const { groupInfo } = await groupOfTwo();
    const carol = await newDevice('user-carol');

    await expect(carol.factory.joinExternally('conv-other', groupInfo)).rejects.toThrow(
      CredentialMismatchError,
    );
    await expect(
      carol.factory.joinExternally(CONVERSATION, new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(CredentialMismatchError);
  });
});
