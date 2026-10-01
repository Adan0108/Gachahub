import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../mls/storage/base64';
import { InMemoryMessagePlaintextStore } from '../mls/storage/messagePlaintextStore';
import { encryptBlob, importBackupKey, type BackupPayload } from './backupCrypto';
import { restoreBackup, type BackupPage } from './backupRestore';

type Item = BackupPage['items'][number];

const userId = 'u1';
const payload = (body: string): BackupPayload => ({
  senderDeviceId: 'd1',
  epoch: 1,
  envelope: { v: 1, type: 'text', body },
});

async function setup() {
  const key = await importBackupKey(crypto.getRandomValues(new Uint8Array(32)));
  // bindTo lets a test seal a blob for one message id but serve it as another.
  const item = async (messageId: string, bindTo = messageId): Promise<Item> => ({
    conversationId: 'c1',
    messageId,
    ciphertext: bytesToBase64(
      await encryptBlob(
        key,
        { userId, conversationId: 'c1', messageId: bindTo },
        payload(`body ${messageId}`),
      ),
    ),
  });
  const pages = (all: Item[][]) =>
    vi.fn(async (after?: string) => {
      const index = after ? Number(after) : 0;
      return { items: all[index]!, nextCursor: index + 1 < all.length ? String(index + 1) : null };
    });
  return { key, item, pages, store: new InMemoryMessagePlaintextStore() };
}

describe('restoreBackup', () => {
  it('walks every page and saves the messages', async () => {
    const { key, item, pages, store } = await setup();
    const fetchPage = pages([[await item('m1'), await item('m2')], [await item('m3')]]);

    const result = await restoreBackup({ key, userId, fetchPage, store });

    expect(result).toMatchObject({ processed: 3, restored: 3, skipped: 0, failed: 0 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await expect(store.get('m3')).resolves.toMatchObject({
      messageId: 'm3',
      conversationId: 'c1',
      envelope: { body: 'body m3' },
    });
  });

  it('skips messages already on this device without overwriting them', async () => {
    const { key, item, pages, store } = await setup();
    const local = {
      messageId: 'm1',
      conversationId: 'c1',
      senderDeviceId: 'x',
      epoch: 9,
      envelope: { v: 1 as const, type: 'text' as const, body: 'local' },
    };
    await store.save(local);

    const result = await restoreBackup({
      key,
      userId,
      fetchPage: pages([[await item('m1'), await item('m2')]]),
      store,
    });

    expect(result).toMatchObject({ restored: 1, skipped: 1 });
    await expect(store.get('m1')).resolves.toEqual(local);
  });

  it('saves without notifying so restored messages are not backed up again', async () => {
    const { key, item, pages } = await setup();
    const saveWithoutNotify = vi.fn();
    const store = { get: vi.fn(async () => undefined), saveWithoutNotify };

    await restoreBackup({ key, userId, fetchPage: pages([[await item('m1')]]), store });

    expect(saveWithoutNotify).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm1' }));
  });

  it('counts a blob swapped onto another message as failed and stores nothing for it', async () => {
    const { key, item, pages, store } = await setup();
    const swapped = await item('m1', 'other-message');

    const result = await restoreBackup({
      key,
      userId,
      fetchPage: pages([[swapped, await item('m2')]]),
      store,
    });

    expect(result).toMatchObject({ restored: 1, failed: 1 });
    await expect(store.get('m1')).resolves.toBeUndefined();
  });

  it('reports progress after each page', async () => {
    const { key, item, pages, store } = await setup();
    const onProgress = vi.fn();

    await restoreBackup({
      key,
      userId,
      fetchPage: pages([[await item('m1')], [await item('m2')]]),
      store,
      onProgress,
    });

    expect(onProgress.mock.calls.map(([p]) => p.processed)).toEqual([1, 2]);
  });

  it('stops when cancelled and says so', async () => {
    const { key, item, pages, store } = await setup();
    const controller = new AbortController();
    const fetchPage = pages([[await item('m1')], [await item('m2')]]);

    const result = await restoreBackup({
      key,
      userId,
      fetchPage,
      store,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    expect(result).toMatchObject({ cancelled: true, restored: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('throws when a page cannot be fetched, keeping what was restored', async () => {
    const { key, item, store } = await setup();
    const first = await item('m1');
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [first], nextCursor: '1' })
      .mockRejectedValueOnce(new Error('offline'));

    await expect(restoreBackup({ key, userId, fetchPage, store })).rejects.toThrow('offline');
    await expect(store.get('m1')).resolves.toBeDefined();
  });
});
