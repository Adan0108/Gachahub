import { api } from '../../api';
import type { DeviceIdentityStore } from '../contract/client';
import type { DeviceId } from '../contract/types';
import { generateKeyPackageUploads, SINGLE_USE_BATCH_SIZE } from './keyPackageBatch';

const LOW_WATER_MARK = 5;
const MIN_CHECK_INTERVAL_MS = 10 * 60_000;
const LAST_RESORT_REFRESH_WINDOW_MS = 14 * 24 * 60 * 60_000;

/** What the sync engine needs: a call that may top up this device's key packages and never throws. */
export interface KeyPackageSupply {
  maybeReplenish(options?: { force?: boolean }): Promise<void>;
}

interface KeyPackageStatus {
  singleUseRemaining: number;
  lastResortExpiresAt: string | null;
}

/** Keeps this device's server-side key packages stocked; throttled after a success, and a failure is retried at the next check. */
export class KeyPackageReplenisher implements KeyPackageSupply {
  private lastCheckAt: number | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly store: Pick<DeviceIdentityStore, 'generateKeyPackages'>,
    private readonly deviceId: DeviceId,
    private readonly now: () => number = Date.now,
  ) {}

  /** `force` skips the throttle (a Welcome just spent a package); overlapping calls share one run. */
  maybeReplenish({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (this.inFlight) return this.inFlight;

    const now = this.now();
    if (!force && this.lastCheckAt !== undefined && now - this.lastCheckAt < MIN_CHECK_INTERVAL_MS) {
      return Promise.resolve();
    }

    this.inFlight = this.replenish()
      .then(() => {
        // Only a run that finished starts the wait; a failed top-up at low stock is retried at the next poll
        this.lastCheckAt = now;
      })
      .catch((error: unknown) => {
        console.warn('Could not replenish key packages', error);
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  private async replenish(): Promise<void> {
    const status = (await api.getChatDeviceKeyPackageStatus(this.deviceId)) as KeyPackageStatus | null;
    if (!status || typeof status.singleUseRemaining !== 'number') return;

    const singleUse = status.singleUseRemaining < LOW_WATER_MARK ? SINGLE_USE_BATCH_SIZE : 0;
    const lastResort = this.lastResortDueForRefresh(status.lastResortExpiresAt);
    if (singleUse === 0 && !lastResort) return;

    const keyPackages = await generateKeyPackageUploads(this.store, { singleUse, lastResort });
    await api.uploadChatDeviceKeyPackages(this.deviceId, { keyPackages });
  }

  private lastResortDueForRefresh(expiresAt: string | null): boolean {
    if (!expiresAt) return false;
    const expiresAtMs = Date.parse(expiresAt);
    return Number.isFinite(expiresAtMs) && expiresAtMs - this.now() <= LAST_RESORT_REFRESH_WINDOW_MS;
  }
}
