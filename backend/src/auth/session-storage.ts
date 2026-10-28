import type { RedisClientType } from 'redis';

// The SAME junk cookie is answered from the cache for a minute; distinct junk still costs one read each.
const MISS_TTL_SECONDS = 60;
// How long a revoked key refuses to be filled again from a database read that started before the revoke.
const REVOKED_TTL_SECONDS = 60;
const ACTIVE_SESSIONS_PREFIX = 'active-sessions-';
// better-auth session tokens are 32 random letters and digits; anything else (rate-limit keys, ...) is not one
const TOKEN_SHAPE = /^[A-Za-z0-9]{20,64}$/;

// Fills a key only if it was not revoked meanwhile: one atomic step, so no instance can bring it back.
const FILL_UNLESS_REVOKED = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1`;

export interface LoadedValue {
  value: string;
  ttlSeconds: number;
}

/** Reads what better-auth would have cached from the database, in the same shape it stores. */
export interface SessionLoader {
  session(token: string): Promise<LoadedValue | null>;
  activeSessions(userId: string): Promise<LoadedValue | null>;
}

type Redis = Pick<RedisClientType, 'get' | 'set' | 'del' | 'eval' | 'multi'>;

/**
 * Where better-auth keeps logins for fast lookups. It lives in Redis, shared by every backend
 * instance, so signing out or revoking a login ends it everywhere at once. A miss (a flushed
 * Redis, say) is filled from the database, which stays the source of truth: while Redis is
 * unreachable, lookups read the database directly.
 */
export class RedisSessionStorage {
  constructor(
    private readonly redis: () => Promise<Redis>,
    private readonly prefix: string,
    private readonly loader?: SessionLoader,
  ) {}

  async get(key: string): Promise<string | null> {
    let redis: Redis;
    let cached: string | null;
    let missed: string | null;
    try {
      redis = await this.redis();
      [cached, missed] = await Promise.all([
        redis.get(this.key(key)),
        redis.get(this.missKey(key)),
      ]);
    } catch {
      return (await this.load(key))?.value ?? null;
    }
    if (cached !== null || !this.loader || missed !== null) return cached;

    const loaded = await this.load(key);
    try {
      if (!loaded) {
        await redis.set(this.missKey(key), '1', { EX: MISS_TTL_SECONDS });
        return null;
      }
      await redis.eval(FILL_UNLESS_REVOKED, {
        keys: [this.key(key), this.revokedKey(key)],
        arguments: [loaded.value, String(Math.max(1, loaded.ttlSeconds))],
      });
    } catch {
      // the database answered; failing to cache it only costs a read next time
    }
    return loaded?.value ?? null;
  }

  /** `ttlSeconds` is how long better-auth wants it kept; none means forever. */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const redis = await this.redis();
    await redis
      .multi()
      .del([this.missKey(key), this.revokedKey(key)])
      .set(this.key(key), value, ttlSeconds ? { EX: ttlSeconds } : undefined)
      .exec();
  }

  /** Throws when Redis cannot be reached, so a revoke is never reported done while other instances still serve it. */
  async delete(key: string): Promise<void> {
    const redis = await this.redis();
    await redis
      .multi()
      .del(this.key(key))
      .set(this.revokedKey(key), '1', { EX: REVOKED_TTL_SECONDS })
      .exec();
  }

  private key(key: string) {
    return `${this.prefix}${key}`;
  }

  private missKey(key: string) {
    return `${this.prefix}miss:${key}`;
  }

  private revokedKey(key: string) {
    return `${this.prefix}revoked:${key}`;
  }

  private load(key: string): Promise<LoadedValue | null> {
    if (!this.loader) return Promise.resolve(null);
    if (key.startsWith(ACTIVE_SESSIONS_PREFIX)) {
      return this.loader.activeSessions(
        key.slice(ACTIVE_SESSIONS_PREFIX.length),
      );
    }

    return TOKEN_SHAPE.test(key)
      ? this.loader.session(key)
      : Promise.resolve(null);
  }
}
