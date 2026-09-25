import { describe, expect, it, vi } from 'vitest';
import { removableDevices, removeDevices, sortDevices, type ChatDeviceInfo } from './deviceList';

const device = (
  id: string,
  createdAt: string,
  revokedAt: string | null = null,
): ChatDeviceInfo => ({ id, ciphersuite: 'x', createdAt, lastSeenAt: null, revokedAt });

describe('device list', () => {
  const devices = [
    device('old', '2026-01-01T00:00:00Z'),
    device('gone', '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z'),
    device('me', '2026-02-01T00:00:00Z'),
    device('new', '2026-04-01T00:00:00Z'),
  ];

  it('offers removal only for live devices other than this one', () => {
    expect(removableDevices(devices, 'me').map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('lists this device first, then live newest first, removed last', () => {
    expect(sortDevices(devices, 'me').map((item) => item.id)).toEqual([
      'me',
      'new',
      'old',
      'gone',
    ]);
  });
});

describe('removeDevices', () => {
  it('revokes each device then reconciles once', async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const outcome = await removeDevices(['a', 'b'], { revoke, reconcile });

    expect(outcome).toEqual({ removed: ['a', 'b'], failed: [] });
    expect(revoke.mock.calls).toEqual([['a'], ['b']]);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('carries on past a failure, counts a 404 as removed, and reports the failure', async () => {
    const boom = new Error('boom');
    const revoke = vi.fn(async (id: string) => {
      if (id === 'a') throw boom;
      if (id === 'b') throw Object.assign(new Error('missing'), { status: 404 });
    });
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const outcome = await removeDevices(['a', 'b', 'c'], { revoke, reconcile });

    expect(outcome.removed).toEqual(['b', 'c']);
    expect(outcome.failed).toEqual([{ deviceId: 'a', error: boom }]);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('skips reconcile when nothing was removed, and survives a reconcile failure', async () => {
    const reconcile = vi.fn().mockRejectedValue(new Error('later'));

    const failing = await removeDevices(['a'], {
      revoke: () => Promise.reject(new Error('x')),
      reconcile,
    });
    expect(failing.removed).toEqual([]);
    expect(reconcile).not.toHaveBeenCalled();

    const outcome = await removeDevices(['a'], { revoke: () => Promise.resolve(), reconcile });
    expect(outcome.removed).toEqual(['a']);
  });
});
