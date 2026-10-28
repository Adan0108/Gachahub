import { RedisSessionStorage, type SessionLoader } from './session-storage';

const TOKEN = 'a'.repeat(32);

/** Just enough of a Redis client: one shared map, as every backend instance would see it. */
function fakeRedis() {
  const values = new Map<string, string>();
  const client = {
    values,
    get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((keys: string | string[]) => {
      for (const key of [keys].flat()) values.delete(key);
      return Promise.resolve(1);
    }),
    eval: jest.fn(
      (
        _script: string,
        { keys, arguments: args }: { keys: string[]; arguments: string[] },
      ) => {
        if (values.has(keys[1])) return Promise.resolve(0);
        values.set(keys[0], args[0]);
        return Promise.resolve(1);
      },
    ),
    multi: () => {
      const steps: Array<() => Promise<unknown>> = [];
      const chain = {
        del: (keys: string | string[]) => {
          steps.push(() => client.del(keys));
          return chain;
        },
        set: (key: string, value: string) => {
          steps.push(() => client.set(key, value));
          return chain;
        },
        exec: async () => {
          for (const step of steps) await step();
          return [];
        },
      };
      return chain;
    },
  };
  return client;
}

describe('RedisSessionStorage', () => {
  const loadSession = jest.fn();
  const loadActiveSessions = jest.fn();
  const loader: SessionLoader = {
    session: loadSession,
    activeSessions: loadActiveSessions,
  };
  let redis: ReturnType<typeof fakeRedis>;
  const storage = (connect = () => Promise.resolve(redis)) =>
    new RedisSessionStorage(connect as never, 'p:', loader);

  beforeEach(() => {
    jest.clearAllMocks();
    redis = fakeRedis();
  });

  it('returns what was stored, and deletes it at once', async () => {
    const one = storage();
    await one.set('token-1', 'session');
    await expect(one.get('token-1')).resolves.toBe('session');

    await one.delete('token-1');
    await expect(one.get('token-1')).resolves.toBeNull();
  });

  // R2-03: a revoke on one instance ends the login on every other one
  it('a login revoked on one instance is gone on another', async () => {
    const instanceA = storage();
    const instanceB = storage();
    await instanceA.set(TOKEN, 'login');
    await expect(instanceB.get(TOKEN)).resolves.toBe('login');

    await instanceA.delete(TOKEN);
    loadSession.mockResolvedValue(null);

    await expect(instanceB.get(TOKEN)).resolves.toBeNull();
  });

  it('fills a miss from the database once, then answers from Redis', async () => {
    loadSession.mockResolvedValue({ value: 'login', ttlSeconds: 100 });
    const one = storage();

    await expect(one.get(TOKEN)).resolves.toBe('login');
    await expect(one.get(TOKEN)).resolves.toBe('login');

    expect(loadSession).toHaveBeenCalledTimes(1);
  });

  it('loads a user list of logins for an active-sessions key', async () => {
    loadActiveSessions.mockResolvedValue({ value: '[]', ttlSeconds: 10 });

    await storage().get('active-sessions-user-1');

    expect(loadActiveSessions).toHaveBeenCalledWith('user-1');
  });

  it('does not hit the database for keys that are not a token, such as rate-limit counters', async () => {
    await expect(storage().get('1.2.3.4/sign-in/email')).resolves.toBeNull();

    expect(loadSession).not.toHaveBeenCalled();
  });

  it('answers a repeated junk cookie from the cache, and forgets that once the login is created', async () => {
    loadSession.mockResolvedValue(null);
    const one = storage();

    await one.get(TOKEN);
    await one.get(TOKEN);
    expect(loadSession).toHaveBeenCalledTimes(1);

    await storage().set(TOKEN, 'fresh login');
    await expect(one.get(TOKEN)).resolves.toBe('fresh login');
  });

  it('does not cache a login that was revoked while it was being read, so it cannot come back', async () => {
    let release!: () => void;
    loadSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ value: 'login', ttlSeconds: 100 });
        }),
    );
    const one = storage();

    const pending = one.get(TOKEN);
    await new Promise((resolve) => setImmediate(resolve));
    await storage().delete(TOKEN); // the revoke lands mid-read, on another instance
    release();
    await pending;

    expect(redis.values.has(`p:${TOKEN}`)).toBe(false);
  });

  it('reads the database directly while Redis is unreachable', async () => {
    loadSession.mockResolvedValue({ value: 'login', ttlSeconds: 100 });
    const down = storage(() => Promise.reject(new Error('redis down')));

    await expect(down.get(TOKEN)).resolves.toBe('login');
    await expect(down.delete(TOKEN)).rejects.toThrow('redis down');
  });
});
