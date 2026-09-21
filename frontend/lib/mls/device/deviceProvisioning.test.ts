import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureDeviceProvisioned, revokeDeviceEverywhere } from './deviceProvisioning';
import { TsMlsDeviceIdentityStore } from '../adapter/tsMlsAdapter';

vi.mock('../../api', () => ({
  api: {
    registerChatDevice: vi.fn().mockResolvedValue({ id: 'device-1' }),
    revokeChatDevice: vi.fn().mockResolvedValue({ message: 'Device revoked successfully' }),
    linkChatDeviceSession: vi.fn().mockResolvedValue({ message: 'Session linked to device' }),
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
    // regression: this used to wipe the old device's local state without
    // ever revoking it on the backend, leaving it permanently ACTIVE there
    expect(api.revokeChatDevice).toHaveBeenCalledWith(first.deviceId);
  });

  // regression: this used to throw and permanently block provisioning for
  // the new user whenever the old device was already gone server-side -
  // see the 404 test on revokeDeviceEverywhere below for the root cause.
  it('still provisions the new user when the old device is already gone server-side (404)', async () => {
    const { api } = await import('../../api');
    const store = new TsMlsDeviceIdentityStore();
    await ensureDeviceProvisioned(store, 'user-1');
    const notFound = new Error('Device not found');
    (notFound as Error & { status?: number }).status = 404;
    vi.mocked(api.revokeChatDevice).mockRejectedValueOnce(notFound);

    const second = await ensureDeviceProvisioned(store, 'user-2');

    expect(second.userId).toBe('user-2');
    expect(await store.isProvisioned()).toBe(true);
  });

  // regression: several hook instances mounting at once (AppShell,
  // chat/page.jsx, useSyncEngine) used to each independently provision a
  // distinct device for the same user, since there was no shared in-flight
  // guard - only whichever one persisted last "won" locally.
  it('dedupes concurrent calls for the same store and user into a single provisioning', async () => {
    const { api } = await import('../../api');
    const store = new TsMlsDeviceIdentityStore();

    const [first, second, third] = await Promise.all([
      ensureDeviceProvisioned(store, 'user-1'),
      ensureDeviceProvisioned(store, 'user-1'),
      ensureDeviceProvisioned(store, 'user-1'),
    ]);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(api.registerChatDevice).toHaveBeenCalledTimes(1);
  });
});

describe('linking the login to the device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('links the login to the device on every call, provisioned already or not', async () => {
    const { api } = await import('../../api');
    const store = new TsMlsDeviceIdentityStore();

    const first = await ensureDeviceProvisioned(store, 'user-1');
    await ensureDeviceProvisioned(store, 'user-1');

    expect(api.linkChatDeviceSession).toHaveBeenCalledTimes(2);
    expect(api.linkChatDeviceSession).toHaveBeenCalledWith(first.deviceId);
  });

  it('still returns the device when linking fails', async () => {
    const { api } = await import('../../api');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(api.linkChatDeviceSession).mockRejectedValueOnce(new Error('offline'));

    await expect(
      ensureDeviceProvisioned(new TsMlsDeviceIdentityStore(), 'user-1'),
    ).resolves.toBeDefined();
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

  // regression: a 404 (the device row is already gone server-side - e.g.
  // its whole account was deleted, taking the device with it via cascade)
  // used to be treated as a real failure and block local cleanup forever,
  // permanently wedging ensureDeviceProvisioned's user-switch path since
  // this browser's stale credential could never be revoked again through a
  // device that no longer exists.
  it('clears local state anyway when the backend device is already gone (404)', async () => {
    const { api } = await import('../../api');
    const notFound = new Error('Device not found');
    (notFound as Error & { status?: number }).status = 404;
    vi.mocked(api.revokeChatDevice).mockRejectedValueOnce(notFound);
    const store = new TsMlsDeviceIdentityStore();
    await ensureDeviceProvisioned(store, 'user-1');

    await expect(revokeDeviceEverywhere(store)).resolves.toBeUndefined();

    expect(await store.isProvisioned()).toBe(false);
  });
});
