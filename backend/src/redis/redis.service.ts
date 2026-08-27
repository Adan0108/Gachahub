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
}
