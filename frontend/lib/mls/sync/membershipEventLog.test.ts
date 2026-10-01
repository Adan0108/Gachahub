import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MembershipEventLog } from './membershipEventLog';
import type { MembershipEvent } from './membershipEvents';
import {
  EncryptedIndexedDbMembershipEventStorage,
  InMemoryMembershipEventStorage,
} from '../storage/membershipEventStorage';
import { resetMlsDatabaseForTests, wipeAllLocalMlsSecrets } from '../storage/mlsEncryptedStore';

const event = (id: string, at = 1): MembershipEvent => ({
  id,
  conversationId: 'conv-1',
  epoch: 1,
  kind: 'joined',
  userId: 'bob',
  at,
});

describe('MembershipEventLog', () => {
  it('keeps events per conversation and ignores a repeated id', async () => {
    const log = new MembershipEventLog(new InMemoryMembershipEventStorage());
    await log.record([event('a')]);
    await log.record([event('a'), event('b')]);

    expect((await log.list('conv-1')).map((item) => item.id)).toEqual(['a', 'b']);
    await expect(log.list('conv-2')).resolves.toEqual([]);
  });

  it('notifies subscribers only when something new was stored', async () => {
    const log = new MembershipEventLog(new InMemoryMembershipEventStorage());
    const listener = vi.fn();
    log.subscribe(listener);

    await log.record([event('a')]);
    await log.record([event('a')]);
    await log.record([]);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not lose events from concurrent records', async () => {
    const log = new MembershipEventLog(new InMemoryMembershipEventStorage());
    await Promise.all([log.record([event('a')]), log.record([event('b')])]);
    expect(await log.list('conv-1')).toHaveLength(2);
  });
});

describe('EncryptedIndexedDbMembershipEventStorage', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetMlsDatabaseForTests();
  });

  it('round-trips events through encryption and reads empty when none exist', async () => {
    const storage = new EncryptedIndexedDbMembershipEventStorage();
    await expect(storage.load('conv-1')).resolves.toEqual([]);

    await storage.add([event('a')]);
    await expect(new EncryptedIndexedDbMembershipEventStorage().load('conv-1')).resolves.toEqual([
      event('a'),
    ]);
  });

  it('keeps conversations apart and returns events oldest first', async () => {
    const storage = new EncryptedIndexedDbMembershipEventStorage();
    await storage.add([event('late', 5), event('early', 1), { ...event('x'), conversationId: 'conv-2' }]);

    expect((await storage.load('conv-1')).map((item) => item.id)).toEqual(['early', 'late']);
    expect((await storage.load('conv-2')).map((item) => item.id)).toEqual(['x']);
  });

  it('collapses the same event written by two tabs and loses none of the others', async () => {
    const tabA = new MembershipEventLog(new EncryptedIndexedDbMembershipEventStorage());
    const tabB = new MembershipEventLog(new EncryptedIndexedDbMembershipEventStorage());

    await Promise.all([
      tabA.record([event('shared'), event('only-a')]),
      tabB.record([event('shared'), event('only-b')]),
    ]);

    const ids = (await tabA.list('conv-1')).map((item) => item.id).sort();
    expect(ids).toEqual(['only-a', 'only-b', 'shared']);
  });

  it('tells subscribers when local data is wiped, and then has no events left to show', async () => {
    const log = new MembershipEventLog(new EncryptedIndexedDbMembershipEventStorage());
    await log.record([event('a')]);
    const listener = vi.fn();
    log.subscribe(listener);

    await wipeAllLocalMlsSecrets();

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(log.list('conv-1')).resolves.toEqual([]);
    log.close();
  });

  it('stops listening for wipes once closed', async () => {
    const log = new MembershipEventLog(new EncryptedIndexedDbMembershipEventStorage());
    const listener = vi.fn();
    log.subscribe(listener);
    log.close();

    await wipeAllLocalMlsSecrets();

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies another tab through the shared channel', async () => {
    const tabA = new MembershipEventLog(new EncryptedIndexedDbMembershipEventStorage(), 'test-events');
    const tabB = new MembershipEventLog(new EncryptedIndexedDbMembershipEventStorage(), 'test-events');
    const listener = vi.fn();
    tabB.subscribe(listener);

    await tabA.record([event('a')]);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    tabA.close();
    tabB.close();
  });
});
