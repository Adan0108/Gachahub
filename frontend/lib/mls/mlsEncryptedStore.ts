import { bytesToBase64, base64ToBytes } from './base64';

const DB_NAME = 'gachahub-mls';
const DB_VERSION = 1;
const KEY_STORE = 'cryptoKeys';
const ENCRYPTION_KEY_RECORD = 'local-encryption-key';

/**
 * Every object store this app's local MLS secrets live in - listed once so
 * opening the database always creates the full schema, and
 * wipeAllLocalMlsSecrets always clears every one of them, not just whichever
 * store a particular caller happens to know about.
 */
const DATA_STORE_NAMES = ['deviceIdentity', 'groupSessions'] as const;
export type DataStoreName = (typeof DATA_STORE_NAMES)[number];

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
 * Generic value -> bytes codec for anything this store encrypts: plain
 * objects (PersistedDeviceIdentity) as well as bare Uint8Array (a
 * GroupSession's serialize() output). ts-mls's types nest Uint8Array (key
 * material) and bigint (Lifetime.notBefore/notAfter) values that JSON can't
 * represent directly - tagged so they round-trip exactly.
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

interface EncryptedRecord {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

let dbPromise: Promise<IDBDatabase> | undefined;

/** Test-only: forces the next openMlsDatabase() call to open a fresh connection - needed when a test swaps out globalThis.indexedDB for isolation. */
export function resetMlsDatabaseForTests(): void {
  dbPromise = undefined;
}

export function openMlsDatabase(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [KEY_STORE, ...DATA_STORE_NAMES]) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
  return dbPromise;
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
 * Encrypts `value` and stores it under `recordId` in `storeName`, using this
 * browser profile's single non-extractable AES-GCM key (threat-model §2,
 * §5) - shared across every local MLS secret so revoking the device via
 * wipeAllLocalMlsSecrets makes all of them equally unrecoverable at once.
 */
export async function encryptAndStore(
  db: IDBDatabase,
  storeName: DataStoreName,
  recordId: string,
  value: unknown,
): Promise<void> {
  const key = await getOrCreateEncryptionKey(db);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = serializeToBytes(value);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.slice() }, key, plaintext.slice()),
  );
  const tx = db.transaction(storeName, 'readwrite');
  await idbRequest(tx.objectStore(storeName).put({ iv, ciphertext }, recordId));
}

export async function loadAndDecrypt<T>(
  db: IDBDatabase,
  storeName: DataStoreName,
  recordId: string,
): Promise<T | undefined> {
  const tx = db.transaction(storeName, 'readonly');
  const record = await idbRequest<EncryptedRecord | undefined>(
    tx.objectStore(storeName).get(recordId),
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
    return deserializeFromBytes<T>(plaintext);
  } catch (error) {
    // Corrupted, or encrypted under a key this browser profile no longer
    // has - treat it as "missing" rather than throwing. Matches the
    // accepted operational gap in threat-model §2: a device whose storage
    // is unreadable is effectively a dead member already; re-provisioning
    // (or rejoining a group) is the safe recovery, not a hard failure.
    console.warn(
      `Could not decrypt stored record "${recordId}" in "${storeName}", treating as missing`,
      error,
    );
    return undefined;
  }
}

export async function deleteRecord(
  db: IDBDatabase,
  storeName: DataStoreName,
  recordId: string,
): Promise<void> {
  const tx = db.transaction(storeName, 'readwrite');
  await idbRequest(tx.objectStore(storeName).delete(recordId));
}

/**
 * Nukes every locally stored MLS secret - device identity, every group
 * session, and the encryption key itself. Used by device revocation ("log
 * out this device everywhere" - irreversible): once the identity is gone,
 * any persisted group state it could decrypt is equally dead, not worth
 * leaving behind as undecryptable clutter.
 */
export async function wipeAllLocalMlsSecrets(): Promise<void> {
  const db = await openMlsDatabase();
  const storeNames = [KEY_STORE, ...DATA_STORE_NAMES];
  const tx = db.transaction(storeNames, 'readwrite');
  await Promise.all(storeNames.map((name) => idbRequest(tx.objectStore(name).clear())));
}
