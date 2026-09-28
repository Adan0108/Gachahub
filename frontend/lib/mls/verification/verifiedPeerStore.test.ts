import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetMlsDatabaseForTests } from '../storage/mlsEncryptedStore';
import {
  EncryptedIndexedDbVerifiedPeerStore,
  InMemoryVerifiedPeerStore,
  type VerifiedPeerStore,
} from './verifiedPeerStore';
import { markVerified } from './verificationState';

const devices = [{ deviceId: 'd1', signatureKey: 'ab12' }];

const key = { ownUserId: 'me', peerUserId: 'peer' };

function sharedBehaviour(name: string, make: () => VerifiedPeerStore) {
  describe(name, () => {
    it('round-trips a record and returns undefined for an unknown peer', async () => {
      const store = make();
      const record = markVerified(undefined, key, devices);
      await store.save(record);
      await expect(store.get(key)).resolves.toEqual(record);
      await expect(store.get({ ...key, peerUserId: 'other' })).resolves.toBeUndefined();
    });

    it('keeps accounts apart', async () => {
      const store = make();
      await store.save(markVerified(undefined, key, devices));
      await expect(store.get({ ...key, ownUserId: 'someone-else' })).resolves.toBeUndefined();
    });

    it('removes a record', async () => {
      const store = make();
      await store.save(markVerified(undefined, key, devices));
      await store.remove(key);
      await expect(store.get(key)).resolves.toBeUndefined();
    });
  });
}

sharedBehaviour('InMemoryVerifiedPeerStore', () => new InMemoryVerifiedPeerStore());

describe('EncryptedIndexedDbVerifiedPeerStore', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetMlsDatabaseForTests();
  });

  sharedBehaviour('behaviour', () => new EncryptedIndexedDbVerifiedPeerStore());

  it('a second instance reads what the first saved', async () => {
    const record = markVerified(undefined, key, devices);
    await new EncryptedIndexedDbVerifiedPeerStore().save(record);
    await expect(new EncryptedIndexedDbVerifiedPeerStore().get(key)).resolves.toEqual(record);
  });
});
