import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrossTabLockUnavailableError } from '../contract/errors';
import { withCrossTabLock } from './crossTabLock';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withCrossTabLock', () => {
  it('refuses to run the task without the Web Locks API, with a message the user can act on', async () => {
    vi.stubGlobal('navigator', {});
    const task = vi.fn(async () => 42);

    const refused = withCrossTabLock('a', task);

    await expect(refused).rejects.toBeInstanceOf(CrossTabLockUnavailableError);
    await expect(refused).rejects.toThrow(/up-to-date browser/);
    expect(task).not.toHaveBeenCalled();
  });

  it('refuses when there is no navigator at all', async () => {
    vi.stubGlobal('navigator', undefined);

    await expect(withCrossTabLock('a', async () => 42)).rejects.toBeInstanceOf(CrossTabLockUnavailableError);
  });

  it('runs the task inside an exclusive lock of that name and returns its result', async () => {
    const request = vi.fn(async (_name: string, _options: unknown, task: () => Promise<unknown>) =>
      task(),
    );
    vi.stubGlobal('navigator', { locks: { request } });

    await expect(withCrossTabLock('mls:d1:c1', async () => 'done')).resolves.toBe('done');

    expect(request).toHaveBeenCalledWith('mls:d1:c1', { mode: 'exclusive' }, expect.any(Function));
  });

  it('passes a failure of the task through', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: async (_n: string, _o: unknown, task: () => Promise<unknown>) => task() },
    });

    await expect(
      withCrossTabLock('a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
