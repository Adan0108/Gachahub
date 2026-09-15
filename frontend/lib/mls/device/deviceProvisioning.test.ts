import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureDeviceProvisioned, revokeDeviceEverywhere } from './deviceProvisioning';
import { TsMlsDeviceIdentityStore } from '../adapter/tsMlsAdapter';

vi.mock('../../api', () => ({
  api: {
    registerChatDevice: vi.fn().mockResolvedValue({ id: 'device-1' }),
    revokeChatDevice: vi.fn().mockResolvedValue({ message: 'Device revoked successfully' }),
  },
}));

describe('ensureDeviceProvisioned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provisions and registers a brand-new device', async () => {
    const { api } = await import('../../api');
    const store = new TsMlsDeviceIdentityStore();

    const credential = await ensureDeviceProvisioned(store, 'user-1');

    expect(credential.userId).toBe('user-1');
    expect(api.registerChatDevice).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(api.registerChatDevice).mock.calls[0]?.[0];
    expect(payload.deviceId).toBe(credential.deviceId);
    expect(payload.keyPackages).toHaveLength(11);
    expect(payload.keyPackages.filter((kp: any) => kp.kind === 'LAST_RESORT')).toHaveLength(1);
    expect(payload.keyPackages.filter((kp: any) => kp.kind === 'SINGLE_USE')).toHaveLength(10);
  });

  it('does not re-register an already-provisioned device for the same user', async () => {
    const { api } = await import('../../api');
    const store = new TsMlsDeviceIdentityStore();
    const first = await ensureDeviceProvisioned(store, 'user-1');
    vi.clearAllMocks();

    const second = await ensureDeviceProvisioned(store, 'user-1');

    expect(second).toEqual(first);
    expect(api.registerChatDevice).not.toHaveBeenCalled();
  });

  it('re-provisions with a fresh device identity when a different user signs in', async () => {
    const { api } = await import('../../api');
    const store = new TsMlsDeviceIdentityStore();
    const first = await ensureDeviceProvisioned(store, 'user-1');
    vi.clearAllMocks();

    const second = await ensureDeviceProvisioned(store, 'user-2');

    expect(second.userId).toBe('user-2');
    expect(second.deviceId).not.toBe(first.deviceId);
    expect(api.registerChatDevice).toHaveBeenCalledTimes(1);
  });
});

describe('revokeDeviceEverywhere', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the backend before clearing local state', async () => {
    const { api } = await import('../../api');
    const store = new TsMlsDeviceIdentityStore();
    const credential = await ensureDeviceProvisioned(store, 'user-1');

    await revokeDeviceEverywhere(store);

    expect(api.revokeChatDevice).toHaveBeenCalledWith(credential.deviceId);
    expect(await store.isProvisioned()).toBe(false);
  });

  it('does not clear local state when the backend call fails', async () => {
    const { api } = await import('../../api');
    vi.mocked(api.revokeChatDevice).mockRejectedValueOnce(new Error('network error'));
    const store = new TsMlsDeviceIdentityStore();
    await ensureDeviceProvisioned(store, 'user-1');

    await expect(revokeDeviceEverywhere(store)).rejects.toThrow('network error');

    expect(await store.isProvisioned()).toBe(true);
  });
});
