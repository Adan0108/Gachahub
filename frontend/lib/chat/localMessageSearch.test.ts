import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saved: new Set<(message: unknown) => void>(),
  removed: new Set<(id: string) => void>(),
  stored: [] as unknown[],
}));

vi.mock('../mls/storage/messagePlaintextStore', () => ({
  EncryptedIndexedDbMessagePlaintextStore: class {
    async listIds() {
      return mocks.stored.map((message) => (message as { messageId: string }).messageId);
    }
    async get(id: string) {
      return mocks.stored.find((message) => (message as { messageId: string }).messageId === id);
    }
  },
  onMessageSaved: (listener: (message: unknown) => void) => {
    mocks.saved.add(listener);
    return () => mocks.saved.delete(listener);
  },
  onMessageRemoved: (listener: (id: string) => void) => {
    mocks.removed.add(listener);
    return () => mocks.removed.delete(listener);
  },
}));

import { acquireMessageSearchIndex, localMessageSearchIndex } from './localMessageSearch';
import { runSessionCleanups } from '../sessionCleanup';

const message = (messageId: string, body: string) => ({
  messageId,
  conversationId: 'c1',
  senderDeviceId: 'd1',
  epoch: 1,
  envelope: { v: 1, type: 'text', body },
});

const search = (query: string) => localMessageSearchIndex.search(query).hits.map((hit) => hit.messageId);

describe('acquireMessageSearchIndex', () => {
  beforeEach(() => {
    mocks.stored = [message('m1', 'already decrypted')];
  });

  it('indexes what is stored, then follows saves and removals', async () => {
    const release = acquireMessageSearchIndex();
    await vi.waitFor(() => expect(localMessageSearchIndex.getSnapshot().status).toBe('ready'));
    expect(search('decrypted')).toEqual(['m1']);

    for (const listener of mocks.saved) listener(message('m2', 'fresh arrival'));
    expect(search('arrival')).toEqual(['m2']);

    for (const listener of mocks.removed) listener('m1');
    expect(search('decrypted')).toEqual([]);

    release();
  });

  it('empties the index and stops listening when the last holder lets go', async () => {
    const first = acquireMessageSearchIndex();
    const second = acquireMessageSearchIndex();
    await vi.waitFor(() => expect(localMessageSearchIndex.getSnapshot().status).toBe('ready'));

    first();
    expect(localMessageSearchIndex.size).toBe(1);
    expect(mocks.saved.size).toBe(1);

    second();
    expect(localMessageSearchIndex.size).toBe(0);
    expect(mocks.saved.size).toBe(0);
    expect(mocks.removed.size).toBe(0);
  });

  it('counts a repeated release only once', async () => {
    const first = acquireMessageSearchIndex();
    const second = acquireMessageSearchIndex();
    await vi.waitFor(() => expect(localMessageSearchIndex.getSnapshot().status).toBe('ready'));

    first();
    first();

    expect(localMessageSearchIndex.size).toBe(1);
    second();
  });

  it('starts over from the store the next time it is acquired', async () => {
    acquireMessageSearchIndex()();
    mocks.stored = [message('m9', 'second visit')];

    const release = acquireMessageSearchIndex();
    await vi.waitFor(() => expect(localMessageSearchIndex.getSnapshot().status).toBe('ready'));

    expect(search('second')).toEqual(['m9']);
    expect(search('decrypted')).toEqual([]);
    release();
  });

  it('is emptied by the sign-out cleanup even while the search screen is still mounted', async () => {
    const release = acquireMessageSearchIndex();
    await vi.waitFor(() => expect(localMessageSearchIndex.getSnapshot().status).toBe('ready'));
    expect(localMessageSearchIndex.size).toBe(1);

    await runSessionCleanups();

    expect(localMessageSearchIndex.size).toBe(0);
    release();
  });
});
