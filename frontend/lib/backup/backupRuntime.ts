import { api } from '../api';
import { base64ToBytes, bytesToBase64 } from '../mls/storage/base64';
import {
  EncryptedIndexedDbMessagePlaintextStore,
  onMessageSaved,
} from '../mls/storage/messagePlaintextStore';
import {
  computeBackupProof,
  deriveReplaceSecret,
  encryptBlob,
  importBackupKey,
  makeKeyCheck,
  type ProofAction,
  verifyKeyCheck,
} from './backupCrypto';
import { restoreBackup, type RestoreProgress, type RestoreResult } from './backupRestore';
import {
  clearBackupState,
  loadStoredBackupKey,
  loadUploadState,
  saveStoredBackupKey,
  saveUploadState,
  type StoredBackupKey,
} from './backupState';
import { BackupUploader, type UploaderStats } from './backupUploader';

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

let uploader: BackupUploader | undefined;
let unsubscribe: (() => void) | undefined;
let activeUserId: string | undefined;
let disabling = false;
const disabledListeners = new Set<() => void>();

export interface BackupStatus {
  enabled: boolean;
  keyCheck: string | null;
  deletionScheduledFor?: string | null;
  blobCount: number;
  bytesUsed: number;
}

// Every change to the uploader or the stored key goes through here, one at a time.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => undefined);
  return result;
}

/** Runs when the server turns out to have backup off (another device turned it off); returns an unsubscribe. */
export function onBackupDisabledElsewhere(listener: () => void): () => void {
  disabledListeners.add(listener);
  return () => disabledListeners.delete(listener);
}

async function stopUploader(options?: { persist?: boolean }): Promise<void> {
  unsubscribe?.();
  const current = uploader;
  unsubscribe = undefined;
  uploader = undefined;
  activeUserId = undefined;
  await current?.stop(options);
}

async function teardown(): Promise<void> {
  await stopUploader();
  await clearBackupState();
}

/** This user's stored key; anything left by another user (or a running uploader of theirs) is wiped first. */
async function ownStoredKey(userId: string): Promise<StoredBackupKey | undefined> {
  const stored = await loadStoredBackupKey();
  if ((activeUserId !== undefined && activeUserId !== userId) || (stored && stored.userId !== userId)) {
    await teardown();
    return undefined;
  }
  return stored;
}

async function handleDisabledElsewhere(): Promise<void> {
  await exclusive(teardown);
  disabledListeners.forEach((listener) => listener());
}

async function startUploader(userId: string, key: CryptoKey): Promise<BackupUploader> {
  await stopUploader({ persist: true });
  const next = new BackupUploader({
    loadMessage: (id) => plaintextStore.get(id),
    loadState: loadUploadState,
    saveState: saveUploadState,
    listIds: () => plaintextStore.listIds(),
    seal: async (message) =>
      bytesToBase64(
        await encryptBlob(
          key,
          { userId, conversationId: message.conversationId, messageId: message.messageId },
          {
            senderDeviceId: message.senderDeviceId,
            epoch: message.epoch,
            envelope: message.envelope,
          },
        ),
      ),
    upload: async (items) => {
      await api.uploadChatBackupBlobs(items);
    },
    onDisabled: () => {
      if (!disabling) void handleDisabledElsewhere();
    },
  });
  uploader = next;
  activeUserId = userId;
  unsubscribe = onMessageSaved((message) => void next.enqueue(message.messageId));
  void next.resume();
  return next;
}

export function stopBackupUploads(): Promise<void> {
  return exclusive(() => stopUploader());
}

/** Logout or account switch: stops uploading and wipes this device's backup key and queue. */
export function endBackupSession(): Promise<void> {
  return exclusive(teardown);
}

/** What the uploader is doing right now; undefined when this device is not backing up. */
export function getBackupUploadStats(): UploaderStats | undefined {
  return uploader?.stats;
}

/** Restarts uploading after a reload if this browser holds this user's key and the server still agrees it is on. */
export function resumeBackup(userId: string, status: BackupStatus): Promise<boolean> {
  return exclusive(async () => {
    // Someone else's key must never seal this user's messages.
    const stored = await ownStoredKey(userId);
    if (!stored) return false;
    const key = await importBackupKey(stored.key);
    stored.key.fill(0);
    const stillValid =
      status.enabled &&
      status.keyCheck &&
      (await verifyKeyCheck(key, userId, base64ToBytes(status.keyCheck)));
    if (!stillValid) {
      // Turned off or rotated on another device: this key no longer opens anything.
      await teardown();
      return false;
    }
    if (activeUserId === userId) return true;
    await startUploader(userId, key);
    return true;
  });
}

async function keyRegistration(userId: string, rawKey: Uint8Array) {
  const key = await importBackupKey(rawKey);
  return {
    key,
    keyCheck: bytesToBase64(await makeKeyCheck(key, userId)),
    replaceSecret: bytesToBase64(await deriveReplaceSecret(rawKey)),
  };
}

/** Registers the key, keeps it here and rescans the local cache; zeroes `rawKey` once saved, leaves it intact on failure. */
export function enableBackup(userId: string, rawKey: Uint8Array): Promise<void> {
  return exclusive(async () => {
    (await ownStoredKey(userId))?.key.fill(0);
    const { key, keyCheck, replaceSecret } = await keyRegistration(userId, rawKey);
    await api.putChatBackupKey({ keyCheck, replaceSecret });
    await saveStoredBackupKey({ userId, key: rawKey });
    rawKey.fill(0);
    await (await startUploader(userId, key)).startRescan();
  });
}

/** Swaps in a new key after proving this device holds the current one; old blobs go, so the cache is re-uploaded. */
export function rotateBackupKey(userId: string, newRawKey: Uint8Array): Promise<void> {
  return exclusive(async () => {
    const stored = await ownStoredKey(userId);
    if (!stored) {
      throw new Error('This device does not hold the current recovery key');
    }
    const { key, keyCheck, replaceSecret } = await keyRegistration(userId, newRawKey);
    const { nonce, proof } = await proveKey(userId, stored.key, 'replace', {
      keyCheck,
      replaceSecret,
    });
    stored.key.fill(0);
    await api.putChatBackupKey({ keyCheck, replaceSecret, replace: true, nonce, proof });
    await saveStoredBackupKey({ userId, key: newRawKey });
    newRawKey.fill(0);
    await (await startUploader(userId, key)).startRescan();
  });
}

/** A fresh single-use nonce answered with a proof that `rawKey` is the current backup key. */
async function proveKey(
  userId: string,
  rawKey: Uint8Array,
  action: ProofAction,
  bound: { keyCheck?: string; replaceSecret?: string } = {},
): Promise<{ nonce: string; proof: string }> {
  const { nonce } = (await api.getChatBackupChallenge()) as { nonce: string };
  const secret = await deriveReplaceSecret(rawKey);
  const proof = await computeBackupProof(secret, action, { userId, nonce, ...bound });
  return { nonce, proof };
}

/** Deletes the backup at once, proving this device holds the key; then forgets the key here. */
export function disableBackup(userId: string): Promise<void> {
  return exclusive(async () => {
    const stored = await ownStoredKey(userId);
    if (!stored) {
      throw new Error('This device does not hold the current recovery key');
    }
    disabling = true;
    try {
      const proof = await proveKey(userId, stored.key, 'delete');
      stored.key.fill(0);
      await api.deleteChatBackup(proof);
      await teardown();
    } finally {
      disabling = false;
    }
  });
}

/** Without the key: asks the server to delete later; the backup keeps working meanwhile. */
export async function scheduleBackupDeletion(): Promise<void> {
  await api.deleteChatBackup();
}

/** Cancels a scheduled deletion with `rawKey`, or with the key this device holds when omitted; the caller zeroes `rawKey`. */
export function cancelBackupDeletion(userId: string, rawKey?: Uint8Array): Promise<void> {
  return exclusive(async () => {
    const stored = rawKey ? undefined : await ownStoredKey(userId);
    const key = rawKey ?? stored?.key;
    if (!key) {
      throw new Error('Cancelling needs the recovery key');
    }
    const proof = await proveKey(userId, key, 'cancel-delete');
    stored?.key.fill(0);
    await api.cancelChatBackupDeletion(proof);
  });
}

/** Restores into this device, then keeps this device backing up too. Throws on network failure. */
export async function restoreOnThisDevice(
  userId: string,
  rawKey: Uint8Array,
  status: BackupStatus,
  options: { onProgress: (progress: RestoreProgress) => void; signal: AbortSignal },
): Promise<RestoreResult | 'wrong-key'> {
  const key = await importBackupKey(rawKey);
  const matches =
    status.keyCheck !== null && (await verifyKeyCheck(key, userId, base64ToBytes(status.keyCheck)));
  if (!matches) return 'wrong-key';

  await exclusive(async () => {
    (await ownStoredKey(userId))?.key.fill(0);
    await saveStoredBackupKey({ userId, key: rawKey });
    // Messages that only exist on this device are not on the server yet.
    await (await startUploader(userId, key)).startRescan();
  });
  return restoreBackup({
    key,
    userId,
    store: plaintextStore,
    fetchPage: (after) => api.getChatBackupBlobs({ after, limit: 100 }),
    ...options,
  });
}
