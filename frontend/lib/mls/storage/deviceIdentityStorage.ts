import type { KeyPackage, PrivateKeyPackage } from 'ts-mls';
import type { DeviceCredential, DeviceId } from '../contract/types';
import { openMlsDatabase, encryptAndStore, loadAndDecryptOrMissing, wipeAllLocalMlsSecrets } from './mlsEncryptedStore';

/** One device's key package, kept locally so joinFromWelcome can match an incoming Welcome back to the private half generateKeyPackages() created */
export interface StoredKeyPackage {
  id: string;
  kind: 'SINGLE_USE' | 'LAST_RESORT' | 'FOUNDER';
  publicPackage: KeyPackage;
  privatePackage: PrivateKeyPackage;
}

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

export class EncryptedIndexedDbDeviceIdentityStorage implements DeviceIdentityStorage {
  async load(): Promise<PersistedDeviceIdentity | undefined> {
    const db = await openMlsDatabase();
    return loadAndDecryptOrMissing<PersistedDeviceIdentity>(db, DEVICE_IDENTITY_STORE, IDENTITY_RECORD);
  }

  async save(identity: PersistedDeviceIdentity): Promise<void> {
    const db = await openMlsDatabase();
    await encryptAndStore(db, DEVICE_IDENTITY_STORE, IDENTITY_RECORD, identity);
  }

  async clear(): Promise<void> {
    // Revoking a device destroys ALL its local secrets, not just the identity blob - any persisted group session state is equally unrecoverable once the device identity that decrypts it is gone
    await wipeAllLocalMlsSecrets();
  }
}
