import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { TsMlsDeviceIdentityStore, TsMlsGroupSessionFactory } from './tsMlsAdapter';
import { EncryptedIndexedDbDeviceIdentityStorage } from '../storage/deviceIdentityStorage';
import { resetMlsDatabaseForTests } from '../storage/mlsEncryptedStore';

describe('TsMlsDeviceIdentityStore persistence', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetMlsDatabaseForTests();
  });

  it('is not provisioned until provision() is called', async () => {
    const store = new TsMlsDeviceIdentityStore(new EncryptedIndexedDbDeviceIdentityStorage());

    expect(await store.isProvisioned()).toBe(false);
    await store.provision('user-1');
    expect(await store.isProvisioned()).toBe(true);
  });

  it('recovers the same credential after a simulated reload', async () => {
    const storage = new EncryptedIndexedDbDeviceIdentityStorage();
    const before = new TsMlsDeviceIdentityStore(storage);
    const credentialBefore = await before.provision('user-1');

    const after = new TsMlsDeviceIdentityStore(storage);

    expect(await after.isProvisioned()).toBe(true);
    const credentialAfter = await after.getOwnCredential();
    expect(credentialAfter).toEqual(credentialBefore);
  });

  it('a reloaded store can still create a new group (its own key package survived)', async () => {
    const storage = new EncryptedIndexedDbDeviceIdentityStorage();
    const before = new TsMlsDeviceIdentityStore(storage);
    await before.provision('user-1');

    const after = new TsMlsDeviceIdentityStore(storage);
    const group = await new TsMlsGroupSessionFactory(after).create('conversation-1');

    expect(await group.currentEpoch()).toBe(0);
  });

  it('a reloaded store can join via a Welcome addressed to a key package generated before the reload', async () => {
    const alice = new TsMlsDeviceIdentityStore();
    await alice.provision('user-alice');
    const aliceFactory = new TsMlsGroupSessionFactory(alice);

    const bobStorage = new EncryptedIndexedDbDeviceIdentityStorage();
    const bobBeforeReload = new TsMlsDeviceIdentityStore(bobStorage);
    await bobBeforeReload.provision('user-bob');
    const bobCredential = await bobBeforeReload.getOwnCredential();
    const [bobOffer] = await bobBeforeReload.generateKeyPackages(1);
    if (!bobOffer) {
      throw new Error('generateKeyPackages(1) returned no key packages');
    }

    const bobAfterReload = new TsMlsDeviceIdentityStore(bobStorage);
    const bobFactoryAfterReload = new TsMlsGroupSessionFactory(bobAfterReload);

    const aliceGroup = await aliceFactory.create('conversation-1');
    const { welcome } = await aliceGroup.stageCommit({
      added: [{ credential: bobCredential, keyPackage: bobOffer }],
      removed: [],
    });
    await aliceGroup.commitAccepted();

    const bobWelcome = welcome;
    if (!bobWelcome) {
      throw new Error('missing Bob Welcome');
    }

    const bobGroup = await bobFactoryAfterReload.joinFromWelcome(
      'conversation-1',
      bobWelcome.welcomeBytes,
    );
    expect(await bobGroup.currentEpoch()).toBe(1);
  });

  it('revoke() clears persisted state so a fresh instance reports unprovisioned', async () => {
    const storage = new EncryptedIndexedDbDeviceIdentityStorage();
    const store = new TsMlsDeviceIdentityStore(storage);
    await store.provision('user-1');

    await store.revoke();

    const after = new TsMlsDeviceIdentityStore(storage);
    expect(await after.isProvisioned()).toBe(false);
  });
});
