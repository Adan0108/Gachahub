import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EncryptedIndexedDbDeviceIdentityStorage,
  InMemoryDeviceIdentityStorage,
  type PersistedDeviceIdentity,
} from './deviceIdentityStorage';
import { openMlsDatabase, resetMlsDatabaseForTests } from './mlsEncryptedStore';

function samplePersistedIdentity(): PersistedDeviceIdentity {
  return {
    deviceId: 'device-1',
    credential: {
      userId: 'user-1',
      deviceId: 'device-1',
      signatureKey: new Uint8Array([1, 2, 3, 4]),
    },
    signatureKeyPair: {
      signKey: new Uint8Array([5, 6, 7]),
      publicKey: new Uint8Array([8, 9, 10]),
    },
    nextKeyPackageId: 3,
    keyPackages: [
      {
        id: 'kp-0',
        kind: 'SINGLE_USE',
        // Real StoredKeyPackage entries nest ts-mls's KeyPackage/
        // PrivateKeyPackage shapes - a plain stand-in with a bigint field is
        // enough to exercise the Uint8Array/bigint round-trip without
        // depending on real MLS crypto output here.
        publicPackage: { fakeField: new Uint8Array([1]), lifetime: 90n } as any,
        privatePackage: { fakeSecret: new Uint8Array([2, 3]) } as any,
      },
    ],
  };
}

describe('InMemoryDeviceIdentityStorage', () => {
  it('round-trips a saved identity', async () => {
    const storage = new InMemoryDeviceIdentityStorage();
    const identity = samplePersistedIdentity();

    await storage.save(identity);

    await expect(storage.load()).resolves.toEqual(identity);
  });

  it('returns undefined before anything is saved, and after clear()', async () => {
    const storage = new InMemoryDeviceIdentityStorage();
    await expect(storage.load()).resolves.toBeUndefined();

    await storage.save(samplePersistedIdentity());
    await storage.clear();

    await expect(storage.load()).resolves.toBeUndefined();
  });
});

describe('EncryptedIndexedDbDeviceIdentityStorage', () => {
  // fake-indexeddb's default global instance persists data across tests in
  // the same file (it's a real in-memory database, not auto-reset) - a
  // fresh IDBFactory per test keeps them isolated, same idea as
  // jest.clearAllMocks() elsewhere in this codebase.
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetMlsDatabaseForTests();
  });

  it('round-trips Uint8Array and bigint fields through encryption', async () => {
    const storage = new EncryptedIndexedDbDeviceIdentityStorage();
    const identity = samplePersistedIdentity();

    await storage.save(identity);
    const loaded = await storage.load();

    expect(loaded).toEqual(identity);
    expect(loaded?.credential.signatureKey).toBeInstanceOf(Uint8Array);
    expect((loaded?.keyPackages[0]?.publicPackage as any).lifetime).toBe(90n);
  });

  it('returns undefined when nothing has been saved yet', async () => {
    const storage = new EncryptedIndexedDbDeviceIdentityStorage();
    await expect(storage.load()).resolves.toBeUndefined();
  });

  it('a second storage instance reads what the first one saved (survives "reload")', async () => {
    const first = new EncryptedIndexedDbDeviceIdentityStorage();
    const identity = samplePersistedIdentity();
    await first.save(identity);

    const second = new EncryptedIndexedDbDeviceIdentityStorage();
    await expect(second.load()).resolves.toEqual(identity);
  });

  it('clear() wipes the identity (and every other local MLS secret)', async () => {
    const storage = new EncryptedIndexedDbDeviceIdentityStorage();
    await storage.save(samplePersistedIdentity());

    await storage.clear();

    await expect(storage.load()).resolves.toBeUndefined();
  });

  it('treats an identity encrypted under a now-deleted key as unprovisioned, not a crash', async () => {
    const storage = new EncryptedIndexedDbDeviceIdentityStorage();
    await storage.save(samplePersistedIdentity());

    // Simulate the encryption key becoming unusable (e.g. a corrupted
    // profile) without touching the encrypted identity blob itself.
    const db = await openMlsDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cryptoKeys', 'readwrite');
      tx.objectStore('cryptoKeys').delete('local-encryption-key');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await expect(storage.load()).resolves.toBeUndefined();
  });
});
