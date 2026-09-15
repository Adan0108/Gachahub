import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EncryptedIndexedDbGroupSessionStorage,
  InMemoryGroupSessionStorage,
} from './groupSessionStorage';
import { resetMlsDatabaseForTests } from './mlsEncryptedStore';

describe('InMemoryGroupSessionStorage', () => {
  it('round-trips saved state per conversation', async () => {
    const storage = new InMemoryGroupSessionStorage();
    const bytes = new Uint8Array([1, 2, 3]);

    await storage.save('conv-1', bytes);

    await expect(storage.load('conv-1')).resolves.toEqual(bytes);
    await expect(storage.load('conv-2')).resolves.toBeUndefined();
  });

  it('delete removes only that conversation', async () => {
    const storage = new InMemoryGroupSessionStorage();
    await storage.save('conv-1', new Uint8Array([1]));
    await storage.save('conv-2', new Uint8Array([2]));

    await storage.delete('conv-1');

    await expect(storage.load('conv-1')).resolves.toBeUndefined();
    await expect(storage.load('conv-2')).resolves.toEqual(new Uint8Array([2]));
  });
});

describe('EncryptedIndexedDbGroupSessionStorage', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetMlsDatabaseForTests();
  });

  it('round-trips a bare Uint8Array through encryption', async () => {
    const storage = new EncryptedIndexedDbGroupSessionStorage();
    const bytes = new Uint8Array([10, 20, 30, 255, 0]);

    await storage.save('conv-1', bytes);

    await expect(storage.load('conv-1')).resolves.toEqual(bytes);
  });

  it('keeps separate conversations independent', async () => {
    const storage = new EncryptedIndexedDbGroupSessionStorage();
    await storage.save('conv-1', new Uint8Array([1]));
    await storage.save('conv-2', new Uint8Array([2]));

    await expect(storage.load('conv-1')).resolves.toEqual(new Uint8Array([1]));
    await expect(storage.load('conv-2')).resolves.toEqual(new Uint8Array([2]));
  });

  it('a second instance reads what the first saved (survives "reload")', async () => {
    const first = new EncryptedIndexedDbGroupSessionStorage();
    await first.save('conv-1', new Uint8Array([7, 8, 9]));

    const second = new EncryptedIndexedDbGroupSessionStorage();
    await expect(second.load('conv-1')).resolves.toEqual(new Uint8Array([7, 8, 9]));
  });

  it('delete removes the record', async () => {
    const storage = new EncryptedIndexedDbGroupSessionStorage();
    await storage.save('conv-1', new Uint8Array([1]));

    await storage.delete('conv-1');

    await expect(storage.load('conv-1')).resolves.toBeUndefined();
  });

  it('returns undefined for a conversation that was never saved', async () => {
    const storage = new EncryptedIndexedDbGroupSessionStorage();
    await expect(storage.load('never-saved')).resolves.toBeUndefined();
  });
});
