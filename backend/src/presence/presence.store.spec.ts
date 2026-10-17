import {
  EXPIRIES_KEY,
  LINGER_KEY,
  SOCKET_STALE_AFTER_MS,
  preferenceKey,
  socketsKey,
} from './presence.constants';
import { PresenceStore, isInvisible } from './presence.store';

describe('PresenceStore', () => {
  const redis = {
    sortedSetTouch: jest.fn(),
    sortedSetRemoveMember: jest.fn(),
    sortedSetLiveCount: jest.fn(),
    sortedSetAdd: jest.fn(),
    sortedSetRemove: jest.fn(),
    sortedSetPopDue: jest.fn(),
    sortedSetScore: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
    delete: jest.fn(),
  };
  let store: PresenceStore;

  beforeEach(() => {
    jest.resetAllMocks();
    store = new PresenceStore(redis as never);
  });

  describe('sockets', () => {
    it('refreshes a socket in the personal set with the stale window', async () => {
      redis.sortedSetTouch.mockResolvedValue({ count: 1, added: true });

      await expect(store.touchSocket('u1', 's1', 1000)).resolves.toEqual({
        count: 1,
        added: true,
      });
      expect(redis.sortedSetTouch).toHaveBeenCalledWith(
        socketsKey('u1'),
        's1',
        1000,
        SOCKET_STALE_AFTER_MS,
      );
    });

    it('says how many sockets are left after one is dropped', async () => {
      redis.sortedSetRemoveMember.mockResolvedValue(1);

      await expect(store.dropSocket('u1', 's1', 1000)).resolves.toBe(1);
      expect(redis.sortedSetRemoveMember).toHaveBeenCalledWith(
        socketsKey('u1'),
        's1',
        1000,
        SOCKET_STALE_AFTER_MS,
      );
    });

    it('lists who has at least one live socket', async () => {
      redis.sortedSetLiveCount.mockImplementation((key: string) =>
        Promise.resolve(key === socketsKey('u2') ? 0 : 2),
      );

      const connected = await store.connectedAmong(['u1', 'u2', 'u3'], 5);

      expect([...connected].sort()).toEqual(['u1', 'u3']);
    });
  });

  describe('invisibility', () => {
    it('saves a timed choice with its end in the expiry queue', async () => {
      await store.setInvisible('u1', 9000);

      expect(redis.setJson).toHaveBeenCalledWith(preferenceKey('u1'), {
        until: 9000,
      });
      expect(redis.sortedSetAdd).toHaveBeenCalledWith(EXPIRIES_KEY, 'u1', 9000);
    });

    it('saves forever with nothing queued, and takes any earlier end out of the queue', async () => {
      await store.setInvisible('u1', null);

      expect(redis.setJson).toHaveBeenCalledWith(preferenceKey('u1'), {
        until: null,
      });
      expect(redis.sortedSetAdd).not.toHaveBeenCalled();
      expect(redis.sortedSetRemove).toHaveBeenCalledWith(EXPIRIES_KEY, 'u1');
    });

    it('clears the choice and its queue entry', async () => {
      await store.clearInvisible('u1');

      expect(redis.delete).toHaveBeenCalledWith(preferenceKey('u1'));
      expect(redis.sortedSetRemove).toHaveBeenCalledWith(EXPIRIES_KEY, 'u1');
    });

    it('lists who is invisible right now, counting forever and unexpired ends only', async () => {
      const byUser: Record<string, unknown> = {
        forever: { until: null },
        later: { until: 2000 },
        over: { until: 500 },
      };
      redis.getJson.mockImplementation((key: string) =>
        Promise.resolve(byUser[key.replace('presence:pref:', '')] ?? null),
      );

      const invisible = await store.invisibleAmong(
        ['forever', 'later', 'over', 'visible'],
        1000,
      );

      expect([...invisible].sort()).toEqual(['forever', 'later']);
    });
  });

  describe('popExpired', () => {
    it('clears and returns those whose time is up', async () => {
      redis.sortedSetPopDue.mockResolvedValue(['u1']);
      redis.getJson.mockResolvedValue({ until: 900 });

      await expect(store.popExpired(1000)).resolves.toEqual(['u1']);
      expect(redis.delete).toHaveBeenCalledWith(preferenceKey('u1'));
    });

    it('leaves someone who chose a later end after being queued', async () => {
      redis.sortedSetPopDue.mockResolvedValue(['u1']);
      redis.getJson.mockResolvedValue({ until: 5000 });

      await expect(store.popExpired(1000)).resolves.toEqual([]);
      expect(redis.delete).not.toHaveBeenCalled();
    });

    it('skips someone who already came back online or went invisible forever', async () => {
      redis.sortedSetPopDue.mockResolvedValue(['gone', 'forever']);
      redis.getJson
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ until: null });

      await expect(store.popExpired(1000)).resolves.toEqual([]);
    });
  });
});

describe('PresenceStore lingering', () => {
  const redis = {
    sortedSetLiveCount: jest.fn(),
    sortedSetScore: jest.fn(),
    sortedSetAdd: jest.fn(),
    sortedSetRemove: jest.fn(),
    sortedSetPopDue: jest.fn(),
  };
  let store: PresenceStore;

  beforeEach(() => {
    jest.resetAllMocks();
    store = new PresenceStore(redis as never);
  });

  it('counts someone who is connected, or lingering, as online', async () => {
    redis.sortedSetLiveCount.mockImplementation((key: string) =>
      Promise.resolve(key === socketsKey('here') ? 1 : 0),
    );
    redis.sortedSetScore.mockImplementation((_key: string, user: string) =>
      Promise.resolve(user === 'gone' ? 5000 : user === 'over' ? 500 : null),
    );

    const online = await store.onlineAmong(
      ['here', 'gone', 'over', 'never'],
      1000,
    );

    expect([...online].sort()).toEqual(['gone', 'here']);
  });

  it('starts lingering with the end as the score', async () => {
    await store.startLingering('u1', 9000);

    expect(redis.sortedSetAdd).toHaveBeenCalledWith(LINGER_KEY, 'u1', 9000);
  });

  it('says whether stopping ended a lingering that others could still see', async () => {
    redis.sortedSetScore.mockResolvedValueOnce(5000);
    await expect(store.stopLingering('u1', 1000)).resolves.toBe(true);
    expect(redis.sortedSetRemove).toHaveBeenCalledWith(LINGER_KEY, 'u1');

    redis.sortedSetScore.mockResolvedValueOnce(500);
    await expect(store.stopLingering('u1', 1000)).resolves.toBe(false);

    redis.sortedSetScore.mockResolvedValueOnce(null);
    await expect(store.stopLingering('u1', 1000)).resolves.toBe(false);
  });

  it('hands back those whose lingering is over', async () => {
    redis.sortedSetPopDue.mockResolvedValue(['u1']);

    await expect(store.popLingerDue(1000)).resolves.toEqual(['u1']);
    expect(redis.sortedSetPopDue).toHaveBeenCalledWith(LINGER_KEY, 1000);
  });
});

describe('isInvisible', () => {
  it('is false with no choice, true until the end, and true forever', () => {
    expect(isInvisible(null, 1)).toBe(false);
    expect(isInvisible({ until: 10 }, 5)).toBe(true);
    expect(isInvisible({ until: 10 }, 10)).toBe(false);
    expect(isInvisible({ until: null }, 1e15)).toBe(true);
  });
});
