import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyPackageReplenisher } from './keyPackageReplenisher';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: {
    getChatDeviceKeyPackageStatus: vi.fn(),
    uploadChatDeviceKeyPackages: vi.fn(),
  },
}));

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function setUp() {
  let now = 1_000_000;
  const store = {
    generateKeyPackages: vi.fn(async (count: number) =>
      Array.from({ length: count }, () => new Uint8Array([1, 2, 3])),
    ),
  };
  const replenisher = new KeyPackageReplenisher(store, 'device-1', () => now);
  return { store, replenisher, advance: (ms: number) => (now += ms), now: () => now };
}

const serveStatus = (singleUseRemaining: number, lastResortExpiresAt: string | null = null) =>
  vi.mocked(api.getChatDeviceKeyPackageStatus).mockResolvedValue({
    singleUseRemaining,
    lastResortExpiresAt,
  } as never);

describe('KeyPackageReplenisher', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('uploads a fresh batch of single-use packages when fewer than 5 remain', async () => {
    const { replenisher, store } = setUp();
    serveStatus(4);

    await replenisher.maybeReplenish();

    expect(store.generateKeyPackages).toHaveBeenCalledWith(10, 'SINGLE_USE');
    const [deviceId, body] = vi.mocked(api.uploadChatDeviceKeyPackages).mock.calls[0]!;
    expect(deviceId).toBe('device-1');
    expect(body.keyPackages).toHaveLength(10);
    expect(body.keyPackages.every((item: { kind: string }) => item.kind === 'SINGLE_USE')).toBe(true);
  });

  it('does nothing while enough packages remain and the last-resort one is far from expiry', async () => {
    const { replenisher, store, now } = setUp();
    serveStatus(5, new Date(now() + 30 * DAY).toISOString());

    await replenisher.maybeReplenish();

    expect(store.generateKeyPackages).not.toHaveBeenCalled();
    expect(api.uploadChatDeviceKeyPackages).not.toHaveBeenCalled();
  });

  it('refreshes only the last-resort package when it expires within 14 days', async () => {
    const { replenisher, store, now } = setUp();
    serveStatus(9, new Date(now() + 13 * DAY).toISOString());

    await replenisher.maybeReplenish();

    expect(store.generateKeyPackages).toHaveBeenCalledTimes(1);
    expect(store.generateKeyPackages).toHaveBeenCalledWith(1, 'LAST_RESORT');
    const [, body] = vi.mocked(api.uploadChatDeviceKeyPackages).mock.calls[0]!;
    expect(body.keyPackages.map((item: { kind: string }) => item.kind)).toEqual(['LAST_RESORT']);
  });

  it('checks at most once per 10 minutes unless forced', async () => {
    const { replenisher, advance } = setUp();
    serveStatus(9);

    await replenisher.maybeReplenish();
    await replenisher.maybeReplenish();
    expect(api.getChatDeviceKeyPackageStatus).toHaveBeenCalledTimes(1);

    await replenisher.maybeReplenish({ force: true });
    expect(api.getChatDeviceKeyPackageStatus).toHaveBeenCalledTimes(2);

    advance(10 * MINUTE);
    await replenisher.maybeReplenish();
    expect(api.getChatDeviceKeyPackageStatus).toHaveBeenCalledTimes(3);
  });

  it('swallows a failure and retries at the very next check, not after the wait', async () => {
    const { replenisher } = setUp();
    vi.mocked(api.getChatDeviceKeyPackageStatus).mockRejectedValueOnce(new Error('offline'));

    await expect(replenisher.maybeReplenish()).resolves.toBeUndefined();

    serveStatus(0);
    await replenisher.maybeReplenish();
    expect(api.uploadChatDeviceKeyPackages).toHaveBeenCalledTimes(1);
  });

  it('starts the wait only once a top-up finished', async () => {
    const { replenisher } = setUp();
    serveStatus(0);
    vi.mocked(api.uploadChatDeviceKeyPackages).mockRejectedValueOnce(new Error('429'));

    await replenisher.maybeReplenish();
    await replenisher.maybeReplenish();
    await replenisher.maybeReplenish();

    expect(api.uploadChatDeviceKeyPackages).toHaveBeenCalledTimes(2);
    expect(api.getChatDeviceKeyPackageStatus).toHaveBeenCalledTimes(2);
  });

  it('swallows an upload failure', async () => {
    const { replenisher } = setUp();
    serveStatus(0);
    vi.mocked(api.uploadChatDeviceKeyPackages).mockRejectedValue(new Error('429'));

    await expect(replenisher.maybeReplenish()).resolves.toBeUndefined();
  });

  it('shares one run between overlapping calls', async () => {
    const { replenisher } = setUp();
    serveStatus(0);

    await Promise.all([
      replenisher.maybeReplenish({ force: true }),
      replenisher.maybeReplenish({ force: true }),
    ]);

    expect(api.getChatDeviceKeyPackageStatus).toHaveBeenCalledTimes(1);
  });
});
