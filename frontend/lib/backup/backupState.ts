import {
  deleteRecord,
  encryptAndStore,
  loadAndDecryptOrMissing,
  openMlsDatabase,
} from '../mls/storage/mlsEncryptedStore';

const STORE = 'backupState';
const KEY_RECORD = 'key';
const QUEUE_RECORD = 'queue';

export interface StoredBackupKey {
  userId: string;
  key: Uint8Array;
}

/** What the uploader still owes: ids to send, and where a full rescan of the local cache stands (null = none pending). */
export interface UploadState {
  queue: string[];
  backfillAfter: string | null;
}

export const EMPTY_UPLOAD_STATE: UploadState = { queue: [], backfillAfter: null };

/** The backup key and upload state live in the device-encrypted store, so a device wipe takes them too. */
export async function loadStoredBackupKey(): Promise<StoredBackupKey | undefined> {
  return loadAndDecryptOrMissing<StoredBackupKey>(await openMlsDatabase(), STORE, KEY_RECORD);
}

export async function saveStoredBackupKey(record: StoredBackupKey): Promise<void> {
  await encryptAndStore(await openMlsDatabase(), STORE, KEY_RECORD, record);
}

export async function loadUploadState(): Promise<UploadState> {
  const stored = await loadAndDecryptOrMissing<UploadState | string[]>(
    await openMlsDatabase(),
    STORE,
    QUEUE_RECORD,
  );
  // An earlier build stored the bare id list.
  if (Array.isArray(stored)) return { queue: stored, backfillAfter: null };
  return stored ?? { ...EMPTY_UPLOAD_STATE };
}

export async function saveUploadState(state: UploadState): Promise<void> {
  await encryptAndStore(await openMlsDatabase(), STORE, QUEUE_RECORD, state);
}

export async function clearBackupState(): Promise<void> {
  const db = await openMlsDatabase();
  await deleteRecord(db, STORE, KEY_RECORD);
  await deleteRecord(db, STORE, QUEUE_RECORD);
}
