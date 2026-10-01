import { afterEach, describe, expect, it, vi } from 'vitest';
import { withCrossTabLock } from './crossTabLock';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withCrossTabLock', () => {
  it('runs the task without the Web Locks API', async () => {
    await expect(withCrossTabLock('a', async () => 42)).resolves.toBe(42);
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
