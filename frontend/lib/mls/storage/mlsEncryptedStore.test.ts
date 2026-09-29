import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encryptAndStore,
  loadAndDecrypt,
  loadAndDecryptOrMissing,
  MlsWipedError,
  onMlsSecretsWiped,
  openMlsDatabase,
  resetMlsDatabaseForTests,
  UnreadableRecordError,
  wipeAllLocalMlsSecrets,
  wipeGroupSessionState,
} from './mlsEncryptedStore';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetMlsDatabaseForTests();
});

async function deleteKey(db: IDBDatabase) {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('cryptoKeys', 'readwrite');
    tx.objectStore('cryptoKeys').delete('local-encryption-key');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('openMlsDatabase', () => {
  it('retries after a failed open instead of caching the failure', async () => {
    const real = globalThis.indexedDB;
    globalThis.indexedDB = {
      open: () => {
        const request = {} as IDBOpenDBRequest;
        setTimeout(() => request.onerror?.(new Event('error')));
        return request;
      },
    } as unknown as IDBFactory;
    await expect(openMlsDatabase()).rejects.toBeDefined();

    globalThis.indexedDB = real;

    await expect(openMlsDatabase()).resolves.toBeDefined();
  });

  it('reopens after another tab asks this connection to let go', async () => {
    const first = await openMlsDatabase();

    first.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent);
    const second = await openMlsDatabase();

    expect(second).not.toBe(first);
    await expect(encryptAndStore(second, 'groupSessions', 'a', { ok: true })).resolves.toBeUndefined();
  });

  it('keeps handing out one connection otherwise', async () => {
    await expect(openMlsDatabase()).resolves.toBe(await openMlsDatabase());
  });
});

describe('loadAndDecrypt', () => {
  it('returns undefined for a missing record', async () => {
    const db = await openMlsDatabase();

    await expect(loadAndDecrypt(db, 'groupSessions', 'nope')).resolves.toBeUndefined();
  });

  it('throws a typed error, not undefined, when a record cannot be decrypted', async () => {
    const db = await openMlsDatabase();
    await encryptAndStore(db, 'groupSessions', 'conv-1', new Uint8Array([1, 2, 3]));
    await deleteKey(db);

    await expect(loadAndDecrypt(db, 'groupSessions', 'conv-1')).rejects.toBeInstanceOf(
      UnreadableRecordError,
    );
  });

  it('loadAndDecryptOrMissing treats an unreadable record as missing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = await openMlsDatabase();
    await encryptAndStore(db, 'decryptedMessages', 'm-1', { text: 'hi' });
    await deleteKey(db);

    await expect(loadAndDecryptOrMissing(db, 'decryptedMessages', 'm-1')).resolves.toBeUndefined();
  });
});

describe('wipeAllLocalMlsSecrets', () => {
  it('resolves only after its transaction committed, and leaves nothing behind', async () => {
    const db = await openMlsDatabase();
    await encryptAndStore(db, 'groupSessions', 'conv-1', new Uint8Array([1]));
    let committed = false;
    const real = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation(((...args: Parameters<typeof real>) => {
      const tx = real(...args);
      tx.addEventListener('complete', () => {
        committed = true;
      });
      return tx;
    }) as typeof db.transaction);

    await wipeAllLocalMlsSecrets();

    expect(committed).toBe(true);
    vi.restoreAllMocks();
    await expect(loadAndDecrypt(db, 'groupSessions', 'conv-1')).resolves.toBeUndefined();
  });
});

describe('a wipe racing other work', () => {
  it('drops a write that began before it, so wiped state and a new key never come back', async () => {
    const db = await openMlsDatabase();
    await encryptAndStore(db, 'groupSessions', 'earlier', new Uint8Array([1]));

    const stale = expect(
      encryptAndStore(db, 'groupSessions', 'conv-1', new Uint8Array([2])),
    ).rejects.toBeInstanceOf(MlsWipedError);
    await wipeAllLocalMlsSecrets();

    await stale;
    await expect(loadAndDecrypt(db, 'groupSessions', 'conv-1')).resolves.toBeUndefined();
    const key = await new Promise((resolve) => {
      const request = db.transaction('cryptoKeys').objectStore('cryptoKeys').get('local-encryption-key');
      request.onsuccess = () => resolve(request.result);
    });
    expect(key).toBeUndefined();
  });

  it('does not affect a write that begins after it', async () => {
    await wipeAllLocalMlsSecrets();
    const db = await openMlsDatabase();

    await encryptAndStore(db, 'groupSessions', 'conv-1', new Uint8Array([2]));

    await expect(loadAndDecrypt(db, 'groupSessions', 'conv-1')).resolves.toEqual(new Uint8Array([2]));
  });

  it('tells listeners, until they unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = onMlsSecretsWiped(listener);

    await wipeAllLocalMlsSecrets();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await wipeAllLocalMlsSecrets();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('drops a write under way when only group state is wiped, and tells listeners', async () => {
    const db = await openMlsDatabase();
    await encryptAndStore(db, 'groupSessions', 'earlier', new Uint8Array([1]));
    const listener = vi.fn();
    const unsubscribe = onMlsSecretsWiped(listener);

    const stale = expect(
      encryptAndStore(db, 'groupSessions', 'conv-1', new Uint8Array([2])),
    ).rejects.toBeInstanceOf(MlsWipedError);
    await wipeGroupSessionState();

    await stale;
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('still tells listeners when the clear itself fails, so caches are dropped anyway', async () => {
    const db = await openMlsDatabase();
    const listener = vi.fn();
    const unsubscribe = onMlsSecretsWiped(listener);
    vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    await expect(wipeAllLocalMlsSecrets()).rejects.toThrow('storage unavailable');

    expect(listener).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    unsubscribe();
  });

  it('tells other tabs before it starts clearing, so they stop writing at once', async () => {
    const db = await openMlsDatabase();
    const order: string[] = [];
    vi.spyOn(BroadcastChannel.prototype, 'postMessage').mockImplementation(() => {
      order.push('broadcast');
    });
    const real = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation(((...args: Parameters<typeof real>) => {
      order.push('clear');
      return real(...args);
    }) as typeof db.transaction);

    await wipeAllLocalMlsSecrets();

    expect(order).toEqual(['broadcast', 'clear']);
    vi.restoreAllMocks();
  });

  it('reaches other tabs through a broadcast, and hears theirs', async () => {
    const otherTab = new BroadcastChannel('gachahub-mls-wipe');
    const heard = vi.fn();
    otherTab.onmessage = heard;
    const listener = vi.fn();
    onMlsSecretsWiped(listener);

    await wipeAllLocalMlsSecrets();
    await vi.waitFor(() => expect(heard).toHaveBeenCalled());

    otherTab.postMessage('wiped');
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    otherTab.close();
  });
});

describe('opening while another tab holds an old version', () => {
  it('gives up after a bounded wait, closes a late connection, and lets the next call retry', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const real = globalThis.indexedDB;
    const request: { onblocked?: () => void; onsuccess?: () => void; result?: unknown } = {};
    globalThis.indexedDB = { open: () => request } as unknown as IDBFactory;

    const opening = openMlsDatabase();
    const failure = expect(opening).rejects.toThrow(/blocked/);
    request.onblocked?.();
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;

    const lateConnection = { close: vi.fn() };
    request.result = lateConnection;
    request.onsuccess?.();
    expect(lateConnection.close).toHaveBeenCalled();

    vi.useRealTimers();
    globalThis.indexedDB = real;
    await expect(openMlsDatabase()).resolves.toBeDefined();
  });
});
