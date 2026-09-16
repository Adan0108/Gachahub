'use client';

import { useEffect } from 'react';
import { useDeviceIdentity, getSharedDeviceIdentityStore } from './useDeviceIdentity';
import { TsMlsGroupSessionFactory } from '../lib/mls/adapter/tsMlsAdapter';
import { SyncEngine } from '../lib/mls/sync/syncEngine';
import type { DeviceId } from '../lib/mls/contract/types';

// One engine per browser tab per device, reused across hook instances - a
// second SyncEngine wrapping the same store would just duplicate the
// in-memory session cache/locks for no benefit.
let sharedEngine: SyncEngine | undefined;
let sharedEngineDeviceId: DeviceId | undefined;
// Guards against processing pending Welcomes more than once per device.
// Module-level, not a per-hook-instance ref: useSyncEngine() is mounted
// from multiple places at once (directly in chat/page.jsx, and again
// inside useDecryptedMessages.ts), all sharing this one engine singleton -
// a per-instance ref would let each instance independently kick off its
// own processPendingWelcomes() call on mount.
let processedWelcomesForDeviceId: DeviceId | undefined;

function getSharedSyncEngine(deviceId: DeviceId): SyncEngine {
  if (!sharedEngine || sharedEngineDeviceId !== deviceId) {
    const factory = new TsMlsGroupSessionFactory(getSharedDeviceIdentityStore());
    sharedEngine = new SyncEngine(factory, deviceId);
    sharedEngineDeviceId = deviceId;
    processedWelcomesForDeviceId = undefined;
  }
  return sharedEngine;
}

/**
 * Returns this device's SyncEngine once its MLS identity is provisioned -
 * undefined until then, since a SyncEngine is meaningless without a
 * deviceId. Also joins any pending Welcomes once, the first time the engine
 * becomes available (e.g. after being added to a new conversation).
 */
export function useSyncEngine(): SyncEngine | undefined {
  const { credential, isReady } = useDeviceIdentity();

  const engine = isReady && credential ? getSharedSyncEngine(credential.deviceId) : undefined;

  useEffect(() => {
    if (!engine || !credential) {
      return;
    }
    if (processedWelcomesForDeviceId === credential.deviceId) {
      return;
    }
    processedWelcomesForDeviceId = credential.deviceId;

    engine.processPendingWelcomes().catch((error: unknown) => {
      console.warn('Could not process pending MLS welcomes', error);
    });
  }, [engine, credential]);

  return engine;
}
