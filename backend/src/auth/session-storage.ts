const SWEEP_INTERVAL_MS = 10 * 60_000;
// How long a known-missing key is answered from memory, so junk cookies cannot hammer the database.
const MISS_TTL_MS = 60_000;
const ACTIVE_SESSIONS_PREFIX = 'active-sessions-';
// better-auth session tokens are 32 random letters and digits; anything else (rate-limit keys, ...) is not one
const TOKEN_SHAPE = /^[A-Za-z0-9]{20,64}$/;

interface Entry {
  value: string;
  expiresAt: number | undefined;
}

export interface LoadedValue {
  value: string;
  ttlSeconds: number;
}

/** Reads what better-auth would have cached from the database, in the same shape it stores. */
export interface SessionLoader {
  session(token: string): Promise<LoadedValue | null>;
  activeSessions(userId: string): Promise<LoadedValue | null>;
}

/**
 * Where better-auth keeps logins for fast lookups, so a request doesn't read the
 * database. It lives in this server's memory, and a miss (after a restart, say)
 * is filled from the database and cached, so it is never slower for long.
 * Deleting an entry takes effect at once. With more than one server this needs a
 * shared store (Redis) behind the same methods.
 */
export class InMemorySessionStorage {
  private readonly entries = new Map<string, Entry>();
  // keys the database said do not exist, each until its expiry
  private readonly misses = new Map<string, number>();
  // counts deletions, so a database read that raced a revoke is not cached
  private deletions = 0;

  constructor(private readonly loader?: SessionLoader) {
    setInterval(() => this.sweep(), SWEEP_INTERVAL_MS).unref();
  }

  async get(key: string): Promise<string | null> {
    const cached = this.getCached(key);
    if (cached !== null || !this.loader) return cached;
    if ((this.misses.get(key) ?? 0) > Date.now()) return null;

    const deletionsBefore = this.deletions;
    const loaded = await this.load(key);
    if (!loaded) {
      if (this.deletions === deletionsBefore) {
        this.misses.set(key, Date.now() + MISS_TTL_MS);
      }
      return null;
    }

    if (this.deletions === deletionsBefore) {
      this.set(key, loaded.value, loaded.ttlSeconds);
    }
    return loaded.value;
  }

  /** `ttlSeconds` is how long better-auth wants it kept; none means forever. */
  set(key: string, value: string, ttlSeconds?: number): void {
    this.misses.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  delete(key: string): void {
    this.deletions += 1;
    this.entries.delete(key);
    this.misses.delete(key);
  }

  private getCached(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    return entry.value;
  }

  private load(key: string): Promise<LoadedValue | null> {
    if (key.startsWith(ACTIVE_SESSIONS_PREFIX)) {
      return this.loader!.activeSessions(
        key.slice(ACTIVE_SESSIONS_PREFIX.length),
      );
    }

    return TOKEN_SHAPE.test(key)
      ? this.loader!.session(key)
      : Promise.resolve(null);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
    for (const [key, expiresAt] of this.misses) {
      if (expiresAt <= now) {
        this.misses.delete(key);
      }
    }
  }
}
