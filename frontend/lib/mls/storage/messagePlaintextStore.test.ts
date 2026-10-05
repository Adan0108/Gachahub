import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EncryptedIndexedDbMessagePlaintextStore,
  InMemoryMessagePlaintextStore,
  onMessageRemoved,
  onMessageSaved,
  type DecryptedMessage,
} from './messagePlaintextStore';
import { resetMlsDatabaseForTests } from './mlsEncryptedStore';

function sampleMessage(): DecryptedMessage {
  return {
    messageId: 'msg-1',
    conversationId: 'conv-1',
    senderDeviceId: 'device-1',
    epoch: 3,
    envelope: { v: 1, type: 'text', body: 'hello there' },
  };
}

describe('InMemoryMessagePlaintextStore', () => {
  it('round-trips a saved message', async () => {
    const store = new InMemoryMessagePlaintextStore();
    const message = sampleMessage();

    await store.save(message);

    await expect(store.get('msg-1')).resolves.toEqual(message);
  });

  it('saveWithoutNotify stores like save', async () => {
    const store = new InMemoryMessagePlaintextStore();

    await store.saveWithoutNotify(sampleMessage());

    await expect(store.get('msg-1')).resolves.toEqual(sampleMessage());
  });

  it('returns undefined for an unknown message', async () => {
    const store = new InMemoryMessagePlaintextStore();
    await expect(store.get('never-saved')).resolves.toBeUndefined();
  });

  it('remove drops a saved message, and is a no-op for one that was never saved', async () => {
    const store = new InMemoryMessagePlaintextStore();
    await store.save(sampleMessage());

    await store.remove('msg-1');
    await store.remove('never-saved');

    await expect(store.get('msg-1')).resolves.toBeUndefined();
  });
});

describe('InMemoryMessagePlaintextStore listeners', () => {
  it('save and remove tell listeners, like the IndexedDB store does', async () => {
    const store = new InMemoryMessagePlaintextStore();
    const saved = vi.fn();
    const removed = vi.fn();
    const stopSaved = onMessageSaved(saved);
    const stopRemoved = onMessageRemoved(removed);

    await store.save(sampleMessage());
    await store.remove('msg-1');
    stopSaved();
    stopRemoved();

    expect(saved).toHaveBeenCalledWith(sampleMessage());
    expect(removed).toHaveBeenCalledWith('msg-1');
  });

  it('saveWithoutNotify stays silent', async () => {
    const store = new InMemoryMessagePlaintextStore();
    const saved = vi.fn();
    const stop = onMessageSaved(saved);

    await store.saveWithoutNotify(sampleMessage());
    stop();

    expect(saved).not.toHaveBeenCalled();
  });
});

describe('EncryptedIndexedDbMessagePlaintextStore', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetMlsDatabaseForTests();
  });

  it('round-trips a saved message through encryption', async () => {
    const store = new EncryptedIndexedDbMessagePlaintextStore();
    const message = sampleMessage();

    await store.save(message);

    await expect(store.get('msg-1')).resolves.toEqual(message);
  });

  it('a second instance reads what the first saved (survives "reload")', async () => {
    const first = new EncryptedIndexedDbMessagePlaintextStore();
    await first.save(sampleMessage());

    const second = new EncryptedIndexedDbMessagePlaintextStore();
    await expect(second.get('msg-1')).resolves.toEqual(sampleMessage());
  });

  it('returns undefined for a message that was never saved', async () => {
    const store = new EncryptedIndexedDbMessagePlaintextStore();
    await expect(store.get('never-saved')).resolves.toBeUndefined();
  });

  it('remove drops a saved message from IndexedDB', async () => {
    const store = new EncryptedIndexedDbMessagePlaintextStore();
    await store.save(sampleMessage());

    await store.remove('msg-1');

    await expect(store.get('msg-1')).resolves.toBeUndefined();
  });

  it('remove tells onMessageRemoved listeners, until they unsubscribe', async () => {
    const store = new EncryptedIndexedDbMessagePlaintextStore();
    const listener = vi.fn();
    const stop = onMessageRemoved(listener);

    await store.remove('msg-1');
    stop();
    await store.remove('msg-2');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('msg-1');
  });

  it('a failing onMessageRemoved listener does not stop the others', async () => {
    const store = new EncryptedIndexedDbMessagePlaintextStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const second = vi.fn();
    const stopFirst = onMessageRemoved(() => {
      throw new Error('boom');
    });
    const stopSecond = onMessageRemoved(second);

    await store.remove('msg-1');
    stopFirst();
    stopSecond();
    warn.mockRestore();

    expect(second).toHaveBeenCalledWith('msg-1');
  });
});
