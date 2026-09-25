import { bytesToBase64, base64ToBytes } from './base64';

const DB_NAME = 'gachahub-mls';
const DB_VERSION = 4;
const KEY_STORE = 'cryptoKeys';
const ENCRYPTION_KEY_RECORD = 'local-encryption-key';

/**
 * Every object store this app's local MLS secrets live in - listed once so
 * opening the database always creates the full schema, and
 * wipeAllLocalMlsSecrets always clears every one of them, not just whichever
 * store a particular caller happens to know about.
 */
const DATA_STORE_NAMES = ['deviceIdentity', 'groupSessions', 'decryptedMessages', 'verifiedPeers', 'membershipEvents', 'backupState'] as const;
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
export function serializeToBytes(value: unknown): Uint8Array {
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

export function deserializeFromBytes<T>(bytes: Uint8Array): T {
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

/** A stored record exists but could not be decrypted or parsed: unlike a missing record, this is never "no data". */
export class UnreadableRecordError extends Error {
  constructor(
    public readonly storeName: string,
    public readonly recordId: string,
    cause?: unknown,
  ) {
    super(`Could not decrypt stored record "${recordId}" in "${storeName}"`, { cause });
    this.name = 'UnreadableRecordError';
  }
}

/** A write that started before a wipe was dropped, so it cannot bring wiped state (or a new key) back. */
export class MlsWipedError extends Error {
  constructor() {
    super('Local MLS data was wiped while this write was in progress');
    this.name = 'MlsWipedError';
  }
}

// How long an open may wait behind another tab's old-version connection before giving up.
const OPEN_BLOCKED_TIMEOUT_MS = 10_000;
const WIPE_CHANNEL_NAME = 'gachahub-mls-wipe';

let dbPromise: Promise<IDBDatabase> | undefined;
let openConnection: IDBDatabase | undefined;
// Bumped by every wipe, in this tab or another: a write that began under an older one is dropped.
let wipeGeneration = 0;
const wipeListeners = new Set<() => void>();
let wipeChannel: BroadcastChannel | undefined;

/** Test-only: forces the next openMlsDatabase() call to open a fresh connection - needed when a test swaps out globalThis.indexedDB for isolation. */
export function resetMlsDatabaseForTests(): void {
  dbPromise = undefined;
  openConnection = undefined;
}

/** Calls `listener` after local MLS data was wiped here or in another tab, so cached copies get dropped. */
export function onMlsSecretsWiped(listener: () => void): () => void {
  ensureWipeChannel();
  wipeListeners.add(listener);
  return () => {
    wipeListeners.delete(listener);
  };
}

export function assertNotWiped(generation: number): void {
  if (generation !== wipeGeneration) throw new MlsWipedError();
}

/** The current wipe generation: snapshot it when a task starts, then assertNotWiped before each write. */
export function currentWipeGeneration(): number {
  return wipeGeneration;
}

function noteWipe(): void {
  wipeGeneration += 1;
  dbPromise = undefined;
  openConnection = undefined;
  for (const listener of wipeListeners) listener();
}

function ensureWipeChannel(): BroadcastChannel | undefined {
  if (wipeChannel || typeof BroadcastChannel === 'undefined') return wipeChannel;
  wipeChannel = new BroadcastChannel(WIPE_CHANNEL_NAME);
  wipeChannel.onmessage = noteWipe;
  // Node keeps its loop alive for an open channel; a browser has no such method.
  (wipeChannel as { unref?: () => void }).unref?.();
  return wipeChannel;
}

function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let gaveUp = false;
    let blockedTimer: ReturnType<typeof setTimeout> | undefined;
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [KEY_STORE, ...DATA_STORE_NAMES]) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    request.onblocked = () => {
      console.warn('Opening the MLS database is blocked by another tab');
      blockedTimer ??= setTimeout(() => {
        gaveUp = true;
        reject(new Error('Opening the MLS database is blocked by another open tab'));
      }, OPEN_BLOCKED_TIMEOUT_MS);
    };
    request.onsuccess = () => {
      clearTimeout(blockedTimer);
      const db = request.result;
      if (gaveUp) {
        db.close();
        return;
      }
      openConnection = db;
      // A stale connection must not drop a newer one's cache.
      const forget = () => {
        if (openConnection !== db) return;
        openConnection = undefined;
        dbPromise = undefined;
      };
      // Another tab upgrading or deleting the database: let go now and reopen on next use.
      db.onversionchange = () => {
        db.close();
        forget();
      };
      db.onclose = forget;
      resolve(db);
    };
    request.onerror = () => {
      clearTimeout(blockedTimer);
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });
}

export function openMlsDatabase(): Promise<IDBDatabase> {
  ensureWipeChannel();
  // A failed open is not cached, so the next call retries.
  const opening: Promise<IDBDatabase> = (dbPromise ??= connect().catch((error: unknown) => {
    if (dbPromise === opening) dbPromise = undefined;
    throw error;
  }));
  return opening;
}

/** Settles when the transaction has committed (or failed): a request succeeding only means it was queued. */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
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
async function getOrCreateEncryptionKey(db: IDBDatabase, generation: number): Promise<CryptoKey> {
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

  // A wipe while the key was being made must not get a new one stored behind it.
  assertNotWiped(generation);
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
  const generation = wipeGeneration;
  const key = await getOrCreateEncryptionKey(db, generation);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = serializeToBytes(value);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.slice() }, key, plaintext.slice()),
  );
  assertNotWiped(generation);
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(storeName).put({ iv, ciphertext }, recordId);
  await done;
}

/** Resolves undefined only when nothing is stored; throws UnreadableRecordError when something is stored but cannot be read. */
export async function loadAndDecrypt<T>(
  db: IDBDatabase,
  storeName: DataStoreName,
  recordId: string,
): Promise<T | undefined> {
  const generation = wipeGeneration;
  const tx = db.transaction(storeName, 'readonly');
  const record = await idbRequest<EncryptedRecord | undefined>(
    tx.objectStore(storeName).get(recordId),
  );
  if (!record) {
    return undefined;
  }

  const key = await getOrCreateEncryptionKey(db, generation);
  try {
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv.slice() },
        key,
        record.ciphertext.slice(),
      ),
    );
    return deserializeFromBytes<T>(plaintext);
  } catch (error) {
    throw new UnreadableRecordError(storeName, recordId, error);
  }
}

/** For records a device can safely rebuild or lose (identity, message cache): unreadable counts as missing. */
export async function loadAndDecryptOrMissing<T>(
  db: IDBDatabase,
  storeName: DataStoreName,
  recordId: string,
): Promise<T | undefined> {
  try {
    return await loadAndDecrypt<T>(db, storeName, recordId);
  } catch (error) {
    if (!(error instanceof UnreadableRecordError)) throw error;
    console.warn(`Could not read stored record "${recordId}" in "${storeName}", treating as missing`, error);
    return undefined;
  }
}

/** Every record id in a store (ids are plain, only values are encrypted). */
export async function listRecordIds(db: IDBDatabase, storeName: DataStoreName): Promise<string[]> {
  const tx = db.transaction(storeName, 'readonly');
  const keys = await idbRequest(tx.objectStore(storeName).getAllKeys());
  return keys.map(String);
}

export async function deleteRecord(
  db: IDBDatabase,
  storeName: DataStoreName,
  recordId: string,
): Promise<void> {
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(storeName).delete(recordId);
  await done;
}

/** Broadcasts first so other tabs stop writing, then clears; caches drop and listeners hear even when the clear fails. */
async function wipeStores(storeNames: readonly string[]): Promise<void> {
  // Before the first await: any write already under way is dropped from here on.
  wipeGeneration += 1;
  ensureWipeChannel()?.postMessage('wiped');
  try {
    const db = await openMlsDatabase();
    const tx = db.transaction([...storeNames], 'readwrite');
    const done = transactionDone(tx);
    for (const name of storeNames) tx.objectStore(name).clear();
    await done;
  } finally {
    noteWipe();
  }
}

/**
 * Nukes every locally stored MLS secret - device identity, every group
 * session, and the encryption key itself. Used by device revocation ("log
 * out this device everywhere" - irreversible): once the identity is gone,
 * any persisted group state it could decrypt is equally dead, not worth
 * leaving behind as undecryptable clutter.
 */
export function wipeAllLocalMlsSecrets(): Promise<void> {
  return wipeStores([KEY_STORE, ...DATA_STORE_NAMES]);
}

/** Clears group state only: for replacing a dead device identity while keeping decrypted history readable. */
export function wipeGroupSessionState(): Promise<void> {
  return wipeStores(['groupSessions']);
}
