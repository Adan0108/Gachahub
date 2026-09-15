import type { KeyPackage, PrivateKeyPackage } from 'ts-mls';
import type { DeviceCredential, DeviceId } from '../contract/types';
import { openMlsDatabase, encryptAndStore, loadAndDecrypt, wipeAllLocalMlsSecrets } from './mlsEncryptedStore';

/**
 * One device's key package, kept locally so joinFromWelcome can match an
 * incoming Welcome back to the private half generateKeyPackages() created.
 */
export interface StoredKeyPackage {
  id: string;
  publicPackage: KeyPackage;
  privatePackage: PrivateKeyPackage;
}

/**
 * Everything TsMlsDeviceIdentityStore needs to resume as the same device
 * after a reload - see client.ts's DeviceIdentityStore doc: "One instance
 * per logged-in user per browser profile, persisted in an encrypted local
 * store" (threat-model §2, §5).
 */
export interface PersistedDeviceIdentity {
  deviceId: DeviceId;
  credential: DeviceCredential;
  signatureKeyPair: { signKey: Uint8Array; publicKey: Uint8Array };
  nextKeyPackageId: number;
  keyPackages: StoredKeyPackage[];
}

export interface DeviceIdentityStorage {
  load(): Promise<PersistedDeviceIdentity | undefined>;
  save(identity: PersistedDeviceIdentity): Promise<void>;
  clear(): Promise<void>;
}

/** Default when no persistence is wanted - the step-2 bake-off/contract tests use this. */
export class InMemoryDeviceIdentityStorage implements DeviceIdentityStorage {
  private value: PersistedDeviceIdentity | undefined;

  async load(): Promise<PersistedDeviceIdentity | undefined> {
    return this.value;
  }

  async save(identity: PersistedDeviceIdentity): Promise<void> {
    this.value = identity;
  }

  async clear(): Promise<void> {
    this.value = undefined;
  }
}

const DEVICE_IDENTITY_STORE = 'deviceIdentity';
const IDENTITY_RECORD = 'device-identity';

/**
 * Encrypted-at-rest device identity storage (threat-model §2, §5) - see
 * mlsEncryptedStore.ts for the shared AES-GCM/IndexedDB plumbing.
 */
export class EncryptedIndexedDbDeviceIdentityStorage implements DeviceIdentityStorage {
  async load(): Promise<PersistedDeviceIdentity | undefined> {
    const db = await openMlsDatabase();
    return loadAndDecrypt<PersistedDeviceIdentity>(db, DEVICE_IDENTITY_STORE, IDENTITY_RECORD);
  }

  async save(identity: PersistedDeviceIdentity): Promise<void> {
    const db = await openMlsDatabase();
    await encryptAndStore(db, DEVICE_IDENTITY_STORE, IDENTITY_RECORD, identity);
  }

  async clear(): Promise<void> {
    // Revoking a device destroys ALL its local secrets, not just the
    // identity blob - any persisted group session state is equally
    // unrecoverable once the device identity that decrypts it is gone.
    await wipeAllLocalMlsSecrets();
  }
}
