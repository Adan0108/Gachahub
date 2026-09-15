import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EncryptedIndexedDbMessagePlaintextStore,
  InMemoryMessagePlaintextStore,
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

  it('returns undefined for an unknown message', async () => {
    const store = new InMemoryMessagePlaintextStore();
    await expect(store.get('never-saved')).resolves.toBeUndefined();
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
});
