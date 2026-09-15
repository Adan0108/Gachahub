import type { KeyPackage, PrivateKeyPackage } from 'ts-mls';
import type { DeviceCredential, DeviceId } from './types';
import { bytesToBase64, base64ToBytes } from './base64';

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

interface TaggedBytes {
  $u8: string;
}

interface TaggedBigInt {
  $bigint: string;
}

function isTaggedBytes(value: unknown): value is TaggedBytes {
  return typeof value === 'object' && value !== null && '$u8' in value;
}

function isTaggedBigInt(value: unknown): value is TaggedBigInt {
  return typeof value === 'object' && value !== null && '$bigint' in value;
}

/**
 * ts-mls's KeyPackage/PrivateKeyPackage are plain objects, but they nest
 * Uint8Array (key material) and bigint (Lifetime.notBefore/notAfter) values
 * that JSON can't represent directly - tagged so they round-trip exactly
 * through the encrypted blob below.
 */
function serializeToBytes(value: unknown): Uint8Array {
  const json = JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Uint8Array) {
      return { $u8: bytesToBase64(v) } satisfies TaggedBytes;
    }
    if (typeof v === 'bigint') {
      return { $bigint: v.toString() } satisfies TaggedBigInt;
    }
    return v;
  });
  return new TextEncoder().encode(json);
}

function deserializeFromBytes<T>(bytes: Uint8Array): T {
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json, (_key, v: unknown) => {
    if (isTaggedBytes(v)) {
      return base64ToBytes(v.$u8);
    }
    if (isTaggedBigInt(v)) {
      return BigInt(v.$bigint);
    }
    return v;
  }) as T;
}

const DB_NAME = 'gachahub-mls';
const DB_VERSION = 1;
const KEY_STORE = 'cryptoKeys';
const IDENTITY_STORE = 'deviceIdentity';
const ENCRYPTION_KEY_RECORD = 'device-identity-key';
const IDENTITY_RECORD = 'device-identity';

interface EncryptedRecord {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
      if (!db.objectStoreNames.contains(IDENTITY_STORE)) {
        db.createObjectStore(IDENTITY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Reads the stored AES-GCM key if present, otherwise generates and stores
 * one. The candidate key is generated OUTSIDE any transaction and re-checked
 * for a race winner inside a single readwrite transaction - awaiting a
 * non-IndexedDB promise (generateKey) while a transaction is open risks the
 * browser auto-committing it before a later `put` ever runs, and two tabs
 * provisioning at once must not end up with two different keys.
 */
async function getOrCreateEncryptionKey(db: IDBDatabase): Promise<CryptoKey> {
  const readTx = db.transaction(KEY_STORE, 'readonly');
  const existing = await idbRequest<CryptoKey | undefined>(
    readTx.objectStore(KEY_STORE).get(ENCRYPTION_KEY_RECORD),
  );
  if (existing) {
    return existing;
  }

  const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);

  const writeTx = db.transaction(KEY_STORE, 'readwrite');
  const store = writeTx.objectStore(KEY_STORE);
  const raceWinner = await idbRequest<CryptoKey | undefined>(store.get(ENCRYPTION_KEY_RECORD));
  if (raceWinner) {
    return raceWinner;
  }
  await idbRequest(store.put(candidate, ENCRYPTION_KEY_RECORD));
  return candidate;
}

/**
 * Encrypted-at-rest device identity storage (threat-model §2, §5). The
 * AES-GCM key is generated non-extractable and never leaves IndexedDB as
 * raw bytes - only the CryptoKey object itself is stored, via structured
 * clone (the standard way to persist a non-extractable WebCrypto key).
 */
export class EncryptedIndexedDbDeviceIdentityStorage implements DeviceIdentityStorage {
  private dbPromise: Promise<IDBDatabase> | undefined;

  private getDb(): Promise<IDBDatabase> {
    this.dbPromise ??= openDatabase();
    return this.dbPromise;
  }

  async load(): Promise<PersistedDeviceIdentity | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(IDENTITY_STORE, 'readonly');
    const record = await idbRequest<EncryptedRecord | undefined>(
      tx.objectStore(IDENTITY_STORE).get(IDENTITY_RECORD),
    );
    if (!record) {
      return undefined;
    }

    try {
      const key = await getOrCreateEncryptionKey(db);
      const plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: record.iv.slice() },
          key,
          record.ciphertext.slice(),
        ),
      );
      return deserializeFromBytes<PersistedDeviceIdentity>(plaintext);
    } catch (error) {
      // Corrupted, or encrypted under a key this browser profile no longer
      // has - treat it as "no local identity" rather than throwing. Matches
      // the accepted operational gap in threat-model §2: a device whose
      // storage is unreadable is effectively a dead member already;
      // re-provisioning is the safe recovery, not a hard failure.
      console.warn(
        'Could not decrypt stored device identity, treating as unprovisioned',
        error,
      );
      return undefined;
    }
  }

  async save(identity: PersistedDeviceIdentity): Promise<void> {
    const db = await this.getDb();
    const key = await getOrCreateEncryptionKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = serializeToBytes(identity);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.slice() }, key, plaintext.slice()),
    );
    const tx = db.transaction(IDENTITY_STORE, 'readwrite');
    await idbRequest(tx.objectStore(IDENTITY_STORE).put({ iv, ciphertext }, IDENTITY_RECORD));
  }

  async clear(): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([IDENTITY_STORE, KEY_STORE], 'readwrite');
    await Promise.all([
      idbRequest(tx.objectStore(IDENTITY_STORE).delete(IDENTITY_RECORD)),
      idbRequest(tx.objectStore(KEY_STORE).delete(ENCRYPTION_KEY_RECORD)),
    ]);
  }
}
