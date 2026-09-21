const SWEEP_INTERVAL_MS = 10 * 60_000;

interface Entry {
  value: string;
  expiresAt: number | undefined;
}

/**
 * Where better-auth keeps logins for fast lookups, so a request doesn't read the
 * database. It lives in this server's memory: a restart just falls back to the
 * database, and revoking a login deletes it here at once. With more than one
 * server this needs a shared store (Redis) behind the same three methods.
 */
export class InMemorySessionStorage {
  private readonly entries = new Map<string, Entry>();

  constructor() {
    setInterval(() => this.sweep(), SWEEP_INTERVAL_MS).unref();
  }

  get(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    return entry.value;
  }

  /** `ttlSeconds` is how long better-auth wants it kept; none means forever. */
  set(key: string, value: string, ttlSeconds?: number): void {
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Signs these logins out of the cache: their own entries, and the user's list of active logins. */
  forgetSessions(userId: string, tokens: readonly string[]): void {
    for (const token of tokens) this.entries.delete(token);
    this.entries.delete(`active-sessions-${userId}`);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export const sessionStorage = new InMemorySessionStorage();
