import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryMessagePlaintextStore,
  onMessageRemoved,
  onMessageSaved,
  type DecryptedMessage,
} from '../mls/storage/messagePlaintextStore';
import { indexingLabel, indexProgressPercent, MessageSearchIndex, searchableText } from './messageSearchIndex';

const KEY = 'A'.repeat(43) + '=';
const file = (name: string, mime = 'application/pdf') => ({
  name,
  mime,
  size: 10,
  blob: name,
  key: KEY,
  iv: 'A'.repeat(16),
  sha256: KEY,
});

const text = (messageId: string, body: string, conversationId = 'c1'): DecryptedMessage => ({
  messageId,
  conversationId,
  senderDeviceId: 'd1',
  epoch: 1,
  envelope: { v: 1, type: 'text', body },
});

const attachment = (messageId: string, files: ReturnType<typeof file>[], body?: string): DecryptedMessage => ({
  messageId,
  conversationId: 'c1',
  senderDeviceId: 'd1',
  epoch: 1,
  envelope: { v: 1, type: 'attachment', body, files },
});

const ids = (index: MessageSearchIndex, query: string, conversationId?: string) =>
  index
    .search(query, { conversationId })
    .hits.map((hit) => hit.messageId)
    .sort();

async function storeWith(...messages: DecryptedMessage[]) {
  const store = new InMemoryMessagePlaintextStore();
  for (const message of messages) await store.save(message);
  return store;
}

describe('searchableText', () => {
  it('is the text of a text message', () => {
    expect(searchableText({ v: 1, type: 'text', body: 'hello' })).toBe('hello');
  });

  it('is the caption and file names of an attachment', () => {
    const envelope = { v: 1, type: 'attachment', body: 'the plan', files: [file('plan.pdf'), file('notes.txt')] };
    expect(searchableText(envelope)).toBe('the plan plan.pdf notes.txt');
  });

  it('is null for an envelope that cannot be read as a message', () => {
    expect(searchableText({ v: 1, type: 'reaction', body: '👍' })).toBeNull();
    expect(searchableText(null)).toBeNull();
  });
});

describe('MessageSearchIndex search', () => {
  let index: MessageSearchIndex;
  beforeEach(() => {
    index = new MessageSearchIndex();
  });

  it('finds messages by a word, ignoring case and accents', () => {
    index.add(text('m1', 'Meet at the Café'));
    index.add(text('m2', 'something else'));

    expect(ids(index, 'CAFE')).toEqual(['m1']);
  });

  it('needs every word of the query', () => {
    index.add(text('m1', 'red apple pie'));
    index.add(text('m2', 'green apple'));

    expect(ids(index, 'apple red')).toEqual(['m1']);
  });

  it('returns the folded terms and the message text with each hit', () => {
    index.add(text('m1', 'Hello World'));

    const result = index.search('WORLD');

    expect(result.terms).toEqual(['world']);
    expect(result.hits).toEqual([{ messageId: 'm1', conversationId: 'c1', text: 'Hello World' }]);
  });

  it('finds nothing for a blank query', () => {
    index.add(text('m1', 'hello'));

    expect(index.search('   ').hits).toEqual([]);
  });

  it('can be limited to one conversation', () => {
    index.add(text('m1', 'pizza night', 'c1'));
    index.add(text('m2', 'pizza party', 'c2'));

    expect(ids(index, 'pizza')).toEqual(['m1', 'm2']);
    expect(ids(index, 'pizza', 'c2')).toEqual(['m2']);
  });

  it('finds an attachment by its caption or file name', () => {
    index.add(attachment('m1', [file('Budget-2026.pdf')], 'for review'));

    expect(ids(index, 'budget')).toEqual(['m1']);
    expect(ids(index, 'review')).toEqual(['m1']);
  });

  it('does not index a message with nothing to read', () => {
    index.add({ ...text('m1', 'x'), envelope: { v: 1, type: 'reaction', body: '👍' } });

    expect(index.size).toBe(0);
  });

  it('replaces a message saved again', () => {
    index.add(text('m1', 'first'));
    index.add(text('m1', 'second'));

    expect(ids(index, 'first')).toEqual([]);
    expect(ids(index, 'second')).toEqual(['m1']);
  });

  it('keeps what is indexed when the same message later arrives in a form that cannot be read', () => {
    index.add(text('m1', 'keep me'));

    index.add({ ...text('m1', 'x'), envelope: { v: 1, type: 'reaction', body: '👍' } });

    expect(ids(index, 'keep')).toEqual(['m1']);
  });

  it('forgets a removed message', () => {
    index.add(text('m1', 'secret plan'));

    index.remove('m1');
    index.remove('never-added');

    expect(ids(index, 'secret')).toEqual([]);
  });

  it('forgets everything on clear', () => {
    index.add(text('m1', 'hello'));

    index.clear();

    expect(index.size).toBe(0);
    expect(index.getSnapshot().status).toBe('idle');
  });
});

describe('MessageSearchIndex syncWith', () => {
  it('indexes everything in the store, going idle -> indexing -> ready', async () => {
    const index = new MessageSearchIndex();
    const statuses: string[] = [];
    index.subscribe(() => statuses.push(index.getSnapshot().status));
    const store = await storeWith(text('m1', 'one'), text('m2', 'two'), text('m3', 'three'));

    await index.syncWith(store, 2);

    expect(index.size).toBe(3);
    expect(index.getSnapshot().status).toBe('ready');
    expect(statuses[0]).toBe('indexing');
    expect(statuses[statuses.length - 1]).toBe('ready');
  });

  it('reports how far along it is, ending complete', async () => {
    const index = new MessageSearchIndex(0);
    const progress: [number, number][] = [];
    index.subscribe(() => progress.push([index.getSnapshot().indexed, index.getSnapshot().total]));
    const store = await storeWith(text('m1', 'one'), text('m2', 'two'), text('m3', 'three'), text('m4', 'four'));

    await index.syncWith(store, 2);

    expect(progress).toContainEqual([2, 4]);
    expect(index.getSnapshot()).toMatchObject({ status: 'ready', indexed: 4, total: 4 });
  });

  it('tells listeners about progress only now and then, not after every batch', async () => {
    const index = new MessageSearchIndex(60_000);
    const listener = vi.fn();
    index.subscribe(listener);
    const store = await storeWith(...Array.from({ length: 10 }, (_, i) => text(`m${i}`, `word ${i}`)));

    await index.syncWith(store, 1);

    // the start, the total being known, and the finish - not one per batch
    expect(listener.mock.calls.length).toBeLessThanOrEqual(3);
    expect(index.size).toBe(10);
    expect(index.getSnapshot().status).toBe('ready');
  });

  it('reads only what is not indexed yet', async () => {
    const index = new MessageSearchIndex();
    const store = await storeWith(text('m1', 'one'), text('m2', 'two'));
    index.add(text('m1', 'one'));
    const get = vi.spyOn(store, 'get');

    await index.syncWith(store);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('m2');
  });

  it('shares one run between callers who ask while it is going', async () => {
    const index = new MessageSearchIndex();
    const store = await storeWith(text('m1', 'one'));
    const listIds = vi.spyOn(store, 'listIds');

    await Promise.all([index.syncWith(store), index.syncWith(store)]);

    expect(listIds).toHaveBeenCalledTimes(1);
  });

  it('skips a message it cannot read and carries on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const index = new MessageSearchIndex();
    const store = await storeWith(text('m1', 'one'), text('m2', 'two'));
    const realGet = store.get.bind(store);
    vi.spyOn(store, 'get').mockImplementation(async (id) => {
      if (id === 'm1') throw new Error('unreadable');
      return realGet(id);
    });

    await index.syncWith(store);

    expect(ids(index, 'two')).toEqual(['m2']);
    expect(index.getSnapshot().status).toBe('ready');
    warn.mockRestore();
  });

  it('goes back to idle when the store cannot be listed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const index = new MessageSearchIndex();
    const store = await storeWith(text('m1', 'one'));
    vi.spyOn(store, 'listIds').mockRejectedValue(new Error('no db'));

    await index.syncWith(store);

    expect(index.getSnapshot().status).toBe('idle');
    warn.mockRestore();
  });

  it('can run again after a finished run', async () => {
    const index = new MessageSearchIndex();
    const store = await storeWith(text('m1', 'one'));
    await index.syncWith(store);

    await store.save(text('m2', 'two'));
    await index.syncWith(store);

    expect(index.size).toBe(2);
  });

  it('stops filling an index that was cleared mid-run', async () => {
    const index = new MessageSearchIndex();
    const store = await storeWith(...Array.from({ length: 6 }, (_, i) => text(`m${i}`, `word ${i}`)));

    const run = index.syncWith(store, 2);
    index.clear();
    await run;

    expect(index.size).toBe(0);
    expect(index.getSnapshot().status).toBe('idle');
  });

  it('does not bring back a message removed while its read was in flight', async () => {
    const index = new MessageSearchIndex();
    const store = await storeWith(text('m1', 'unsent words'));
    const realGet = store.get.bind(store);
    vi.spyOn(store, 'get').mockImplementation(async (id) => {
      const saved = await realGet(id);
      index.remove(id);
      return saved;
    });

    await index.syncWith(store);

    expect(index.size).toBe(0);
  });

  it('keeps a message added live while the run is going', async () => {
    const index = new MessageSearchIndex();
    const store = await storeWith(text('m1', 'one'), text('m2', 'two'));

    const run = index.syncWith(store, 1);
    index.add(text('live', 'arrived during the run'));
    await run;

    expect(ids(index, 'arrived')).toEqual(['live']);
    expect(index.size).toBe(3);
  });
});

describe('MessageSearchIndex following the store', () => {
  it('picks up what a store saves and removes through its listeners', async () => {
    const index = new MessageSearchIndex();
    const store = new InMemoryMessagePlaintextStore();
    const stops = [onMessageSaved((message) => index.add(message)), onMessageRemoved((id) => index.remove(id))];

    await store.save(text('m1', 'live message'));
    expect(ids(index, 'live')).toEqual(['m1']);

    await store.remove('m1');
    expect(ids(index, 'live')).toEqual([]);
    stops.forEach((stop) => stop());
  });

  it('does not see what a store saves without telling anyone', async () => {
    const index = new MessageSearchIndex();
    const store = new InMemoryMessagePlaintextStore();
    const stop = onMessageSaved((message) => index.add(message));

    await store.saveWithoutNotify(text('m1', 'restored quietly'));
    stop();

    expect(index.size).toBe(0);
  });
});

describe('indexing progress text', () => {
  it('is a percentage once the total is known', () => {
    expect(indexProgressPercent({ indexed: 25, total: 100 })).toBe(25);
    expect(indexProgressPercent({ indexed: 5, total: 3 })).toBe(100);
    expect(indexingLabel({ indexed: 25, total: 100 })).toBe('Indexing messages on this device (25%)...');
  });

  it('has no percentage before the total is known', () => {
    expect(indexProgressPercent({ indexed: 0, total: 0 })).toBeNull();
    expect(indexingLabel({ indexed: 0, total: 0 })).toBe('Indexing messages on this device...');
  });
});

describe('MessageSearchIndex snapshot', () => {
  it('changes whenever the index does, and stops notifying after unsubscribe', () => {
    const index = new MessageSearchIndex();
    const listener = vi.fn();
    const stop = index.subscribe(listener);
    const before = index.getSnapshot();

    index.add(text('m1', 'hello'));
    const after = index.getSnapshot();
    stop();
    index.add(text('m2', 'again'));

    expect(after).not.toBe(before);
    expect(after.version).toBeGreaterThan(before.version);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the same snapshot object while nothing changes', () => {
    const index = new MessageSearchIndex();

    expect(index.getSnapshot()).toBe(index.getSnapshot());
  });
});
