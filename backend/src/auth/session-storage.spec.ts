import { InMemorySessionStorage } from './session-storage';

describe('InMemorySessionStorage', () => {
  let storage: InMemorySessionStorage;

  beforeEach(() => {
    jest.useFakeTimers();
    storage = new InMemorySessionStorage();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns what was stored, and null for anything else', () => {
    storage.set('token-1', 'session');

    expect(storage.get('token-1')).toBe('session');
    expect(storage.get('token-2')).toBeNull();
  });

  it('forgets an entry once its time is up', () => {
    storage.set('token-1', 'session', 60);

    jest.advanceTimersByTime(59_000);
    expect(storage.get('token-1')).toBe('session');

    jest.advanceTimersByTime(2_000);
    expect(storage.get('token-1')).toBeNull();
  });

  it('deletes an entry at once', () => {
    storage.set('token-1', 'session');

    storage.delete('token-1');

    expect(storage.get('token-1')).toBeNull();
  });

  it('signs logins out of the cache along with the user’s list of active logins, and leaves others alone', () => {
    storage.set('token-1', 'a');
    storage.set('token-2', 'b');
    storage.set('active-sessions-user-1', '["token-1","token-2"]');
    storage.set('active-sessions-user-2', '["token-9"]');

    storage.forgetSessions('user-1', ['token-1']);

    expect(storage.get('token-1')).toBeNull();
    expect(storage.get('active-sessions-user-1')).toBeNull();
    expect(storage.get('token-2')).toBe('b');
    expect(storage.get('active-sessions-user-2')).not.toBeNull();
  });
});
