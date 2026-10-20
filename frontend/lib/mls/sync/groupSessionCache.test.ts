import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrossTabLockUnavailableError } from '../contract/errors';
import type { GroupSessionFactory } from '../contract/client';
import { InMemoryGroupSessionStorage } from '../storage/groupSessionStorage';
import { GroupSessionCache } from './groupSessionCache';

afterEach(() => {
  vi.unstubAllGlobals();
});

const makeCache = (storage = new InMemoryGroupSessionStorage()) =>
  new GroupSessionCache({} as GroupSessionFactory, storage, 'device-1', { mark: vi.fn() });

const decode = (bytes: Uint8Array | undefined) => (bytes ? Number(new TextDecoder().decode(bytes)) : 0);

/** What a send does to the saved ratchet: read the generation, take a moment, save the next one. */
async function takeNextGeneration(storage: InMemoryGroupSessionStorage): Promise<number> {
  const generation = decode(await storage.load('ratchet'));
  await new Promise((resolve) => setTimeout(resolve, 2));
  await storage.save('ratchet', new TextEncoder().encode(String(generation + 1)));
  return generation;
}

describe('GroupSessionCache.runExclusive without cross-tab locking', () => {
  it('refuses the work instead of running it unprotected', async () => {
    vi.stubGlobal('navigator', {});
    const task = vi.fn(async () => 'sent');

    await expect(makeCache().runExclusive('c1', task)).rejects.toBeInstanceOf(CrossTabLockUnavailableError);

    expect(task).not.toHaveBeenCalled();
  });

  it('keeps refusing every attempt, and a refusal does not jam the queue', async () => {
    vi.stubGlobal('navigator', {});
    const cache = makeCache();

    const first = cache.runExclusive('c1', async () => 1);
    const second = cache.runExclusive('c1', async () => 2);

    await expect(first).rejects.toBeInstanceOf(CrossTabLockUnavailableError);
    await expect(second).rejects.toBeInstanceOf(CrossTabLockUnavailableError);
  });
});

describe('two tabs of one device sharing saved state', () => {
  it('never use the same sender generation when they send at once', async () => {
    const storage = new InMemoryGroupSessionStorage();
    const tabs = [makeCache(storage), makeCache(storage)];

    const used = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        tabs[index % 2]!.runExclusive('c1', () => takeNextGeneration(storage)),
      ),
    );

    expect(new Set(used).size).toBe(12);
    expect(decode(await storage.load('ratchet'))).toBe(12);
  });

  it('would reuse generations without the lock, which is what the lock is for', async () => {
    const storage = new InMemoryGroupSessionStorage();

    const used = await Promise.all(Array.from({ length: 12 }, () => takeNextGeneration(storage)));

    expect(new Set(used).size).toBeLessThan(12);
  });

  it('queue per group, so different groups do not wait for each other', async () => {
    const storage = new InMemoryGroupSessionStorage();
    const cache = makeCache(storage);
    let releaseFirst!: () => void;
    const blocked = cache.runExclusive('c1', () => new Promise<void>((resolve) => (releaseFirst = resolve)));

    await expect(cache.runExclusive('c2', async () => 'other group')).resolves.toBe('other group');

    releaseFirst();
    await blocked;
  });
});
