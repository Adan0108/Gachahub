import { describe, expect, it, vi } from 'vitest';
import { registerSessionCleanup, runSessionCleanups } from './sessionCleanup';

describe('sessionCleanup', () => {
  it('runs every registered cleanup even when one fails', async () => {
    const good = vi.fn();
    const stop = registerSessionCleanup(() => {
      throw new Error('boom');
    });
    const stopGood = registerSessionCleanup(good);

    await expect(runSessionCleanups()).resolves.toBeUndefined();

    expect(good).toHaveBeenCalledTimes(1);
    stop();
    stopGood();
  });

  it('stops running a cleanup once it is unregistered', async () => {
    const cleanup = vi.fn();
    registerSessionCleanup(cleanup)();

    await runSessionCleanups();

    expect(cleanup).not.toHaveBeenCalled();
  });
});
