import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EncryptedIndexedDbMessagePlaintextStore,
  type DecryptedMessage,
} from '../mls/storage/messagePlaintextStore';
import { resetMlsDatabaseForTests } from '../mls/storage/mlsEncryptedStore';
import { runSessionCleanups } from '../sessionCleanup';
import { computeBackupProof, deriveReplaceSecret } from './backupCrypto';
import { generateBackupKey } from './backupKey';
import {
  cancelBackupDeletion,
  disableBackup,
  enableBackup,
  endBackupSession,
  getBackupUploadStats,
  onBackupDisabledElsewhere,
  resumeBackup,
  restoreOnThisDevice,
  rotateBackupKey,
  scheduleBackupDeletion,
  stopBackupUploads,
  type BackupStatus,
} from './backupRuntime';
import './backupSessionCleanup';
import { loadStoredBackupKey, loadUploadState, saveUploadState } from './backupState';

const api = vi.hoisted(() => ({
  putChatBackupKey: vi.fn(async () => ({ enabled: true })),
  deleteChatBackup: vi.fn(async (_proof?: object) => ({ enabled: false })),
  cancelChatBackupDeletion: vi.fn(async (_proof: object) => ({ enabled: true })),
  getChatBackupChallenge: vi.fn(async () => ({ nonce: 'bm9uY2U=' })),
  uploadChatBackupBlobs: vi.fn(async () => ({ stored: 1, skipped: 0 })),
  getChatBackupBlobs: vi.fn(async () => ({ items: [], nextCursor: null })),
}));
vi.mock('../api', () => ({ api }));

const store = new EncryptedIndexedDbMessagePlaintextStore();
const message = (id: string): DecryptedMessage => ({
  messageId: id,
  conversationId: 'c1',
  senderDeviceId: 'd1',
  epoch: 1,
  envelope: { v: 1, type: 'text', body: id },
});
const uploadedIds = () =>
  (api.uploadChatBackupBlobs.mock.calls as unknown as { messageId: string }[][][]).flatMap(
    ([items]) => items!.map((item) => item.messageId),
  );

async function enable(userId = 'u1') {
  const raw = generateBackupKey();
  const original = raw.slice();
  await enableBackup(userId, raw);
  const [{ keyCheck }] = api.putChatBackupKey.mock.calls[0] as unknown as [{ keyCheck: string }];
  const status: BackupStatus = { enabled: true, keyCheck, blobCount: 0, bytesUsed: 0 };
  return { original, raw, status };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetMlsDatabaseForTests();
  vi.clearAllMocks();
});

afterEach(async () => {
  await endBackupSession();
});

describe('enableBackup', () => {
  it('registers key check and replace secret, keeps the key, zeroes the raw key and uploads what is cached', async () => {
    await store.save(message('old1'));

    const { original, raw } = await enable();

    expect(api.putChatBackupKey).toHaveBeenCalledWith({
      keyCheck: expect.any(String),
      replaceSecret: expect.any(String),
    });
    expect(raw).toEqual(new Uint8Array(32));
    await expect(loadStoredBackupKey()).resolves.toEqual({ userId: 'u1', key: original });
    await vi.waitFor(() => expect(uploadedIds()).toEqual(['old1']));
  });

  it('leaves the raw key intact when the server refuses, so the caller can retry', async () => {
    api.putChatBackupKey.mockRejectedValueOnce(new Error('409'));
    const raw = generateBackupKey();
    const copy = raw.slice();

    await expect(enableBackup('u1', raw)).rejects.toThrow('409');

    expect(raw).toEqual(copy);
    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
  });

  it('uploads messages saved afterwards', async () => {
    await enable();

    await store.save(message('new1'));

    await vi.waitFor(() => expect(uploadedIds()).toContain('new1'), { timeout: 4000 });
  });
});

describe('logout and account switch', () => {
  it('the session cleanup stops uploads and wipes the key and queue', async () => {
    await enable();
    await saveUploadState({ queue: ['left-over'], backfillAfter: null });
    expect(getBackupUploadStats()).toBeDefined();

    await runSessionCleanups();

    expect(getBackupUploadStats()).toBeUndefined();
    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
    await expect(loadUploadState()).resolves.toEqual({ queue: [], backfillAfter: null });
    api.uploadChatBackupBlobs.mockClear();
    await store.save(message('after-logout'));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(api.uploadChatBackupBlobs).not.toHaveBeenCalled();
  });

  it('another user resuming wipes the first user key and never seals under it', async () => {
    const { status } = await enable('u1');

    await expect(resumeBackup('u2', status)).resolves.toBe(false);

    expect(getBackupUploadStats()).toBeUndefined();
    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
    api.uploadChatBackupBlobs.mockClear();
    await store.save(message('b-msg'));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(api.uploadChatBackupBlobs).not.toHaveBeenCalled();
  });

  it('a key left on disk by another user is wiped, not resumed, after a reload', async () => {
    const { status } = await enable('u1');
    // Simulates a reload: no running uploader, the key on disk belongs to u1.
    await stopBackupUploads();

    await expect(resumeBackup('u2', status)).resolves.toBe(false);

    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
  });

  it('resuming as the key owner keeps the same uploader running', async () => {
    const { status } = await enable('u1');

    await expect(resumeBackup('u1', status)).resolves.toBe(true);
    await expect(resumeBackup('u1', status)).resolves.toBe(true);

    expect(getBackupUploadStats()).toBeDefined();
  });

  it('a rotated or disabled server key clears local state on resume', async () => {
    const { status } = await enable('u1');

    await expect(resumeBackup('u1', { ...status, enabled: false })).resolves.toBe(false);

    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
    expect(getBackupUploadStats()).toBeUndefined();
  });
});

describe('backup turned off elsewhere', () => {
  it('a 409 clears local state and tells listeners', async () => {
    await enable();
    const listener = vi.fn();
    const off = onBackupDisabledElsewhere(listener);
    api.uploadChatBackupBlobs.mockRejectedValue(Object.assign(new Error('off'), { status: 409 }));

    await store.save(message('m1'));

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
    await expect(loadUploadState()).resolves.toEqual({ queue: [], backfillAfter: null });
    expect(getBackupUploadStats()).toBeUndefined();
    off();
    api.uploadChatBackupBlobs.mockResolvedValue({ stored: 1, skipped: 0 });
  });

  it('turning it off here does not report it as another device', async () => {
    await enable();
    const listener = vi.fn();
    const off = onBackupDisabledElsewhere(listener);

    await disableBackup('u1');

    expect(api.deleteChatBackup).toHaveBeenCalled();
    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
    expect(getBackupUploadStats()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    off();
  });
});

describe('turning backup off', () => {
  it('a device holding the key proves it and deletes at once', async () => {
    const { original } = await enable();

    await disableBackup('u1');

    const [proof] = api.deleteChatBackup.mock.calls[0] as unknown as [
      { nonce: string; proof: string },
    ];
    expect(proof).toEqual({
      nonce: 'bm9uY2U=',
      proof: await computeBackupProof(await deriveReplaceSecret(original), 'delete', {
        userId: 'u1',
        nonce: 'bm9uY2U=',
      }),
    });
    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
  });

  it('a device without the key cannot delete at once', async () => {
    await expect(disableBackup('u1')).rejects.toThrow('does not hold the current recovery key');

    expect(api.getChatBackupChallenge).not.toHaveBeenCalled();
    expect(api.deleteChatBackup).not.toHaveBeenCalled();
  });

  it('scheduling sends no proof and keeps the key and uploads', async () => {
    await enable();

    await scheduleBackupDeletion();

    expect(api.deleteChatBackup).toHaveBeenCalledWith();
    expect(api.getChatBackupChallenge).not.toHaveBeenCalled();
    await expect(loadStoredBackupKey()).resolves.toBeDefined();
    expect(getBackupUploadStats()).toBeDefined();
  });
});

describe('cancelBackupDeletion', () => {
  const cancelProof = async (raw: Uint8Array) => ({
    nonce: 'bm9uY2U=',
    proof: await computeBackupProof(await deriveReplaceSecret(raw), 'cancel-delete', {
      userId: 'u1',
      nonce: 'bm9uY2U=',
    }),
  });

  it('proves with a typed recovery key on a device that has none', async () => {
    const raw = generateBackupKey();
    const expected = await cancelProof(raw);

    await cancelBackupDeletion('u1', raw);

    expect(api.cancelChatBackupDeletion).toHaveBeenCalledWith(expected);
  });

  it('uses the key this device holds when none is typed', async () => {
    const { original } = await enable();

    await cancelBackupDeletion('u1');

    expect(api.cancelChatBackupDeletion).toHaveBeenCalledWith(await cancelProof(original));
  });

  it('refuses with no key at all', async () => {
    await expect(cancelBackupDeletion('u1')).rejects.toThrow('needs the recovery key');

    expect(api.cancelChatBackupDeletion).not.toHaveBeenCalled();
  });
});

describe('rotateBackupKey', () => {
  it('proves it holds the current key, binding the new key check and secret', async () => {
    const { original } = await enable();
    const next = generateBackupKey();
    const nextCopy = next.slice();

    await rotateBackupKey('u1', next);

    const [payload] = api.putChatBackupKey.mock.calls[1] as unknown as [
      { keyCheck: string; replaceSecret: string; replace: boolean; nonce: string; proof: string },
    ];
    expect(payload).toMatchObject({ replace: true, nonce: 'bm9uY2U=' });
    const expected = await computeBackupProof(await deriveReplaceSecret(original), 'replace', {
      userId: 'u1',
      nonce: 'bm9uY2U=',
      keyCheck: payload.keyCheck,
      replaceSecret: payload.replaceSecret,
    });
    expect(payload.proof).toBe(expected);
    await expect(loadStoredBackupKey()).resolves.toEqual({ userId: 'u1', key: nextCopy });
  });

  it('refuses without the current key on this device', async () => {
    await expect(rotateBackupKey('u1', generateBackupKey())).rejects.toThrow(
      'does not hold the current recovery key',
    );
    expect(api.getChatBackupChallenge).not.toHaveBeenCalled();
    expect(api.putChatBackupKey).not.toHaveBeenCalled();
  });
});

describe('restoreOnThisDevice', () => {
  it('queues messages that only exist on this device', async () => {
    const { original, status } = await enable();
    await endBackupSession();
    api.uploadChatBackupBlobs.mockClear();
    await store.save(message('local-only'));

    const outcome = await restoreOnThisDevice('u1', original, status, {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    });

    expect(outcome).not.toBe('wrong-key');
    await vi.waitFor(() => expect(uploadedIds()).toEqual(['local-only']));
  });

  it('rejects the wrong key without touching stored state', async () => {
    const { status } = await enable();
    await endBackupSession();

    await expect(
      restoreOnThisDevice('u1', generateBackupKey(), status, {
        onProgress: () => undefined,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('wrong-key');
    await expect(loadStoredBackupKey()).resolves.toBeUndefined();
  });
});
