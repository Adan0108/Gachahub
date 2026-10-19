import { Inject, Injectable } from '@nestjs/common';
import type { RedisClientType } from 'redis';

import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService {
  private readonly prefix = process.env.REDIS_KEY_PREFIX ?? 'gachahub:dev:';

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: RedisClientType,
  ) {}

  private key(value: string): string {
    return `${this.prefix}${value}`;
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(this.key(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const redisKey = this.key(key);

    if (ttlSeconds) {
      await this.client.set(redisKey, value, {
        EX: ttlSeconds,
      });

      return;
    }

    await this.client.set(redisKey, value);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(this.key(key))) === 1;
  }

  async increment(key: string): Promise<number> {
    return this.client.incr(this.key(key));
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(this.key(key), ttlSeconds);
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);

    if (!value) {
      return null;
    }

    return JSON.parse(value) as T;
  }

  /** Several JSON values in one command, null where a key is empty. */
  async getManyJson<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];

    const values = await this.client.mGet(keys.map((key) => this.key(key)));
    return values.map((value) => (value ? (JSON.parse(value) as T) : null));
  }

  getClient(): RedisClientType {
    return this.client;
  }

  async incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const redisKey = this.key(key);

    const result = await this.client.eval(
      `
      local count = redis.call('INCR', KEYS[1])

      if count == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end

      return count
    `,
      {
        keys: [redisKey],
        arguments: [String(ttlSeconds)],
      },
    );

    return Number(result);
  }

  /** Adds or refreshes a member's score in a sorted set, drops members not refreshed within staleAfterMs, and reports the live count and whether the member was new. */
  async sortedSetTouch(
    key: string,
    member: string,
    nowMs: number,
    staleAfterMs: number,
  ): Promise<{ count: number; added: boolean }> {
    const redisKey = this.key(key);
    const results = await this.client
      .multi()
      .zRemRangeByScore(redisKey, '-inf', nowMs - staleAfterMs)
      .zAdd(redisKey, { score: nowMs, value: member })
      .zCard(redisKey)
      .expire(redisKey, Math.ceil((staleAfterMs * 2) / 1000))
      .exec();

    return { added: Number(results[1]) === 1, count: Number(results[2]) };
  }

  /** Removes one member, then reports how many live members are left. */
  async sortedSetRemoveMember(
    key: string,
    member: string,
    nowMs: number,
    staleAfterMs: number,
  ): Promise<number> {
    const redisKey = this.key(key);
    const results = await this.client
      .multi()
      .zRem(redisKey, member)
      .zRemRangeByScore(redisKey, '-inf', nowMs - staleAfterMs)
      .zCard(redisKey)
      .exec();

    return Number(results[2]);
  }

  /** How many members were refreshed within staleAfterMs. */
  async sortedSetLiveCount(
    key: string,
    nowMs: number,
    staleAfterMs: number,
  ): Promise<number> {
    return this.client.zCount(this.key(key), nowMs - staleAfterMs, '+inf');
  }

  /** The same count for several sorted sets, in one round trip. */
  async sortedSetLiveCounts(
    keys: string[],
    nowMs: number,
    staleAfterMs: number,
  ): Promise<number[]> {
    if (keys.length === 0) return [];

    const pipeline = this.client.multi();
    for (const key of keys) {
      pipeline.zCount(this.key(key), nowMs - staleAfterMs, '+inf');
    }
    const counts = await pipeline.execAsPipeline();

    return counts.map(Number);
  }

  async sortedSetAdd(key: string, member: string, score: number) {
    await this.client.zAdd(this.key(key), { score, value: member });
  }

  /** Deletes the key only if it still holds exactly this value, so a newer write is never lost. */
  async deleteIfEquals(key: string, expected: string): Promise<boolean> {
    const deleted = await this.client.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
      { keys: [this.key(key)], arguments: [expected] },
    );

    return Number(deleted) === 1;
  }

  async sortedSetScore(key: string, member: string): Promise<number | null> {
    return this.client.zScore(this.key(key), member);
  }

  /** Scores of several members of one sorted set in one command; null for a member that is not there. */
  async sortedSetScores(
    key: string,
    members: string[],
  ): Promise<(number | null)[]> {
    if (members.length === 0) return [];

    return this.client.zmScore(this.key(key), members);
  }

  async sortedSetRemove(key: string, member: string) {
    await this.client.zRem(this.key(key), member);
  }

  /** Takes the members whose score is at or below maxScore, in one step, so a member rescheduled meanwhile is never removed and two callers never get the same one. */
  async sortedSetPopDue(key: string, maxScore: number): Promise<string[]> {
    const due = await this.client.eval(
      `local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
      for _, member in ipairs(due) do redis.call('ZREM', KEYS[1], member) end
      return due`,
      { keys: [this.key(key)], arguments: [String(maxScore)] },
    );

    return due as string[];
  }
}
