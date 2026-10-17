import {
  EXPIRIES_KEY,
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

describe('isInvisible', () => {
  it('is false with no choice, true until the end, and true forever', () => {
    expect(isInvisible(null, 1)).toBe(false);
    expect(isInvisible({ until: 10 }, 5)).toBe(true);
    expect(isInvisible({ until: 10 }, 10)).toBe(false);
    expect(isInvisible({ until: null }, 1e15)).toBe(true);
  });
});
