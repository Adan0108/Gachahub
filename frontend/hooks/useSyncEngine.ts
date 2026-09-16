'use client';

import { useDeviceIdentity, getSharedDeviceIdentityStore } from './useDeviceIdentity';
import { TsMlsGroupSessionFactory } from '../lib/mls/adapter/tsMlsAdapter';
import { SyncEngine } from '../lib/mls/sync/syncEngine';
import type { DeviceId } from '../lib/mls/contract/types';

// One engine per browser tab per device, reused across hook instances - a
// second SyncEngine wrapping the same store would just duplicate the
// in-memory session cache/locks for no benefit.
let sharedEngine: SyncEngine | undefined;
let sharedEngineDeviceId: DeviceId | undefined;
let welcomePollIntervalId: ReturnType<typeof setInterval> | undefined;

// Being added to a conversation only creates a Welcome for this device once
// - if this browser was already open at the time, a one-shot "check on
// mount" never notices it, and this device can never join, decrypt, or
// reply. Polling is a stopgap for not having a live push mechanism for it
// yet (the socket infra used for typing indicators doesn't cover this) -
// cheap enough for one lightweight GET per tab at this interval.
const WELCOME_POLL_INTERVAL_MS = 5000;

function checkForPendingWelcomes(engine: SyncEngine): void {
  engine.processPendingWelcomes().catch((error: unknown) => {
    console.warn('Could not process pending MLS welcomes', error);
  });
}

function getSharedSyncEngine(deviceId: DeviceId): SyncEngine {
  if (!sharedEngine || sharedEngineDeviceId !== deviceId) {
    const factory = new TsMlsGroupSessionFactory(getSharedDeviceIdentityStore());
    const engine = new SyncEngine(factory, deviceId);
    sharedEngine = engine;
    sharedEngineDeviceId = deviceId;

    // Tied to this engine's lifetime, not any one component's - polling
    // must keep running for as long as this device identity is the active
    // one, regardless of which chat components happen to be mounted.
    if (welcomePollIntervalId !== undefined) {
      clearInterval(welcomePollIntervalId);
    }
    checkForPendingWelcomes(engine);
    welcomePollIntervalId = setInterval(
      () => checkForPendingWelcomes(engine),
      WELCOME_POLL_INTERVAL_MS,
    );
  }
  return sharedEngine;
}

/**
 * Returns this device's SyncEngine once its MLS identity is provisioned -
 * undefined until then, since a SyncEngine is meaningless without a
 * deviceId. Also polls for pending Welcomes for as long as this device
 * identity is active (e.g. after being added to a new conversation).
 */
export function useSyncEngine(): SyncEngine | undefined {
  const { credential, isReady } = useDeviceIdentity();

  return isReady && credential ? getSharedSyncEngine(credential.deviceId) : undefined;
}
