import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { RedisService } from './redis.service';

// Talks to a real Redis (REDIS_URL, default localhost) because the point is how the commands
// behave together; with no Redis running the tests are skipped, not failed. Keys are namespaced
// per run and removed afterwards.
describe('RedisService sorted-set queue (real Redis)', () => {
  jest.setTimeout(30_000);
  const prefix = `gachahub:test:${randomUUID()}:`;
  let client: RedisClientType | undefined;
  let service: RedisService;
  const queue = 'due-queue';

  beforeAll(async () => {
    process.env.REDIS_KEY_PREFIX = prefix;
    const candidate: RedisClientType = createClient({
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      socket: { reconnectStrategy: false },
    });
    candidate.on('error', () => undefined);
    try {
      await candidate.connect();
      client = candidate;
      service = new RedisService(candidate);
    } catch {
      console.warn('No Redis reachable: skipping the real Redis queue tests');
    }
  });

  afterAll(async () => {
    if (!client) return;
    const keys = await client.keys(`${prefix}*`);
    if (keys.length > 0) await client.del(keys);
    await client.quit();
  });

  afterEach(async () => {
    if (client) await client.del(`${prefix}${queue}`);
  });

  it('takes the due members and leaves the ones not due yet', async () => {
    if (!client) return;
    await service.sortedSetAdd(queue, 'old', 100);
    await service.sortedSetAdd(queue, 'now', 1000);
    await service.sortedSetAdd(queue, 'later', 5000);

    const due = await service.sortedSetPopDue(queue, 1000);

    expect(due.sort()).toEqual(['now', 'old']);
    expect(await service.sortedSetScore(queue, 'later')).toBe(5000);
    expect(await service.sortedSetScore(queue, 'old')).toBeNull();
  });

  it('returns nothing, and changes nothing, when nothing is due', async () => {
    if (!client) return;
    await service.sortedSetAdd(queue, 'later', 5000);

    await expect(service.sortedSetPopDue(queue, 1000)).resolves.toEqual([]);
    expect(await service.sortedSetScore(queue, 'later')).toBe(5000);
  });

  it('never gives the same member to two callers polling at once', async () => {
    if (!client) return;
    const members = Array.from({ length: 200 }, (_, index) => `m${index}`);
    for (const member of members) await service.sortedSetAdd(queue, member, 1);

    const batches = await Promise.all(
      Array.from({ length: 8 }, () => service.sortedSetPopDue(queue, 10)),
    );

    const all = batches.flat();
    expect(all).toHaveLength(members.length);
    expect(new Set(all).size).toBe(members.length);
  });

  it('keeps a member that was rescheduled to later while a poll ran', async () => {
    if (!client) return;

    for (let round = 0; round < 60; round += 1) {
      await service.sortedSetAdd(queue, 'renewed', 1);

      await Promise.all([
        service.sortedSetPopDue(queue, 10),
        service.sortedSetAdd(queue, 'renewed', 999_999),
      ]);

      // Whichever happened first, the later time must still be queued.
      expect(await service.sortedSetScore(queue, 'renewed')).toBe(999_999);
    }
  });

  it('reads the scores of several members in one go, null for a missing one', async () => {
    if (!client) return;
    await service.sortedSetAdd(queue, 'a', 10);
    await service.sortedSetAdd(queue, 'b', 20);

    await expect(
      service.sortedSetScores(queue, ['b', 'nobody', 'a']),
    ).resolves.toEqual([20, null, 10]);
    await expect(service.sortedSetScores(queue, [])).resolves.toEqual([]);
  });

  it('counts the live members of several sets in one go', async () => {
    if (!client) return;
    const keys = [`${queue}:one`, `${queue}:two`, `${queue}:none`];
    await service.sortedSetAdd(keys[0], 'old', 100);
    await service.sortedSetAdd(keys[0], 'fresh', 1000);
    await service.sortedSetAdd(keys[1], 'fresh', 990);

    await expect(service.sortedSetLiveCounts(keys, 1000, 50)).resolves.toEqual([
      1, 1, 0,
    ]);
    await expect(service.sortedSetLiveCounts([], 1000, 50)).resolves.toEqual(
      [],
    );
    await client.del(keys.map((key) => `${prefix}${key}`));
  });

  it('reads several JSON values in one go, null for an empty key', async () => {
    if (!client) return;
    await service.setJson(`${queue}:json1`, { until: 5 });

    await expect(
      service.getManyJson([`${queue}:json1`, `${queue}:json2`]),
    ).resolves.toEqual([{ until: 5 }, null]);
    await expect(service.getManyJson([])).resolves.toEqual([]);
    await client.del(`${prefix}${queue}:json1`);
  });
});
