import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EncryptedIndexedDbMessagePlaintextStore,
  onMessageSaved,
  type DecryptedMessage,
} from '../mls/storage/messagePlaintextStore';
import {
  encryptAndStore,
  openMlsDatabase,
  resetMlsDatabaseForTests,
  wipeAllLocalMlsSecrets,
} from '../mls/storage/mlsEncryptedStore';
import {
  clearBackupState,
  loadStoredBackupKey,
  loadUploadState,
  saveStoredBackupKey,
  saveUploadState,
} from './backupState';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetMlsDatabaseForTests();
});

const message = (id: string): DecryptedMessage => ({
  messageId: id,
  conversationId: 'c1',
  senderDeviceId: 'd1',
  epoch: 1,
  envelope: { v: 1, type: 'text', body: id },
});

describe('backup state', () => {
  it('round-trips the key and the queue, and starts empty', async () => {
    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
    await expect(loadUploadState()).resolves.toEqual({ queue: [], backfillAfter: null });

    await saveStoredBackupKey({ userId: 'u1', key: new Uint8Array([1, 2, 3]) });
    await saveUploadState({ queue: ['a', 'b'], backfillAfter: 'm' });

    await expect(loadStoredBackupKey()).resolves.toEqual({
      userId: 'u1',
      key: new Uint8Array([1, 2, 3]),
    });
    await expect(loadUploadState()).resolves.toEqual({ queue: ['a', 'b'], backfillAfter: 'm' });
  });

  it('reads the bare id list an earlier build stored', async () => {
    await encryptAndStore(await openMlsDatabase(), 'backupState', 'queue', ['a']);

    await expect(loadUploadState()).resolves.toEqual({ queue: ['a'], backfillAfter: null });
  });

  it('clearBackupState removes both', async () => {
    await saveStoredBackupKey({ userId: 'u1', key: new Uint8Array([1]) });
    await saveUploadState({ queue: ['a'], backfillAfter: null });

    await clearBackupState();

    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
    await expect(loadUploadState()).resolves.toEqual({ queue: [], backfillAfter: null });
  });

  it('a device wipe removes the backup key', async () => {
    await saveStoredBackupKey({ userId: 'u1', key: new Uint8Array([1]) });

    await wipeAllLocalMlsSecrets();

    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
  });
});

describe('message-saved listener', () => {
  const store = new EncryptedIndexedDbMessagePlaintextStore();

  it('fires for a normal save but not for saveWithoutNotify', async () => {
    const listener = vi.fn();
    const off = onMessageSaved(listener);

    await store.save(message('m1'));
    await store.saveWithoutNotify(message('m2'));
    off();
    await store.save(message('m3'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm1' }));
  });

  it('a throwing listener does not fail the save', async () => {
    const off = onMessageSaved(() => {
      throw new Error('boom');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(store.save(message('m1'))).resolves.toBeUndefined();
    off();
  });

  it('lists every cached message id', async () => {
    await store.save(message('m1'));
    await store.saveWithoutNotify(message('m2'));

    expect((await store.listIds()).sort()).toEqual(['m1', 'm2']);
  });
});
