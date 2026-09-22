import { InMemorySessionStorage, type SessionLoader } from './session-storage';

const TOKEN = 'a'.repeat(32);

describe('InMemorySessionStorage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns what was stored, and null for anything else', async () => {
    const storage = new InMemorySessionStorage();
    storage.set('token-1', 'session');

    await expect(storage.get('token-1')).resolves.toBe('session');
    await expect(storage.get('token-2')).resolves.toBeNull();
  });

  it('forgets an entry once its time is up', async () => {
    const storage = new InMemorySessionStorage();
    storage.set('token-1', 'session', 60);

    jest.advanceTimersByTime(59_000);
    await expect(storage.get('token-1')).resolves.toBe('session');

    jest.advanceTimersByTime(2_000);
    await expect(storage.get('token-1')).resolves.toBeNull();
  });

  it('deletes an entry at once', async () => {
    const storage = new InMemorySessionStorage();
    storage.set('token-1', 'session');

    storage.delete('token-1');

    await expect(storage.get('token-1')).resolves.toBeNull();
  });

  describe('with a loader for cache misses', () => {
    const loadSession = jest.fn();
    const loadActiveSessions = jest.fn();
    const loader: SessionLoader = {
      session: loadSession,
      activeSessions: loadActiveSessions,
    };
    let storage: InMemorySessionStorage;

    beforeEach(() => {
      jest.clearAllMocks();
      storage = new InMemorySessionStorage(loader);
    });

    it('fills a miss from the database once, then answers from memory', async () => {
      loadSession.mockResolvedValue({ value: 'login', ttlSeconds: 100 });

      await expect(storage.get(TOKEN)).resolves.toBe('login');
      await expect(storage.get(TOKEN)).resolves.toBe('login');

      expect(loadSession).toHaveBeenCalledTimes(1);
    });

    it('loads a user list of logins for an active-sessions key', async () => {
      loadActiveSessions.mockResolvedValue({ value: '[]', ttlSeconds: 10 });

      await storage.get('active-sessions-user-1');

      expect(loadActiveSessions).toHaveBeenCalledWith('user-1');
    });

    it('does not hit the database for keys that are not a token, such as rate-limit counters', async () => {
      await expect(storage.get('1.2.3.4/sign-in/email')).resolves.toBeNull();

      expect(loadSession).not.toHaveBeenCalled();
    });

    it('answers a repeated junk cookie from memory instead of reading the database again', async () => {
      loadSession.mockResolvedValue(null);

      await expect(storage.get(TOKEN)).resolves.toBeNull();
      await expect(storage.get(TOKEN)).resolves.toBeNull();

      expect(loadSession).toHaveBeenCalledTimes(1);
    });

    it('forgets a known-missing key the moment that login is created', async () => {
      loadSession.mockResolvedValue(null);
      await storage.get(TOKEN);

      storage.set(TOKEN, 'fresh login');

      await expect(storage.get(TOKEN)).resolves.toBe('fresh login');
    });

    it('does not cache a login that was revoked while it was being read, so it cannot come back', async () => {
      let release!: () => void;
      loadSession.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ value: 'login', ttlSeconds: 100 });
          }),
      );

      const pending = storage.get(TOKEN);
      storage.delete(TOKEN); // the revoke lands mid-read
      release();
      await pending;
      loadSession.mockResolvedValue(null); // the row is gone from the database now

      await expect(storage.get(TOKEN)).resolves.toBeNull();
    });
  });
});
