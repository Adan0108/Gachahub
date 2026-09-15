'use client';

import { useEffect, useRef } from 'react';
import { useDeviceIdentity, getSharedDeviceIdentityStore } from './useDeviceIdentity';
import { TsMlsGroupSessionFactory } from '../lib/mls/tsMlsAdapter';
import { SyncEngine } from '../lib/mls/syncEngine';
import type { DeviceId } from '../lib/mls/types';

// One engine per browser tab per device, reused across hook instances - a
// second SyncEngine wrapping the same store would just duplicate the
// in-memory session cache/locks for no benefit.
let sharedEngine: SyncEngine | undefined;
let sharedEngineDeviceId: DeviceId | undefined;

function getSharedSyncEngine(deviceId: DeviceId): SyncEngine {
  if (!sharedEngine || sharedEngineDeviceId !== deviceId) {
    const factory = new TsMlsGroupSessionFactory(getSharedDeviceIdentityStore());
    sharedEngine = new SyncEngine(factory, deviceId);
    sharedEngineDeviceId = deviceId;
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
  const processedWelcomesForDeviceRef = useRef<DeviceId | undefined>(undefined);

  const engine = isReady && credential ? getSharedSyncEngine(credential.deviceId) : undefined;

  useEffect(() => {
    if (!engine || !credential) {
      return;
    }
    if (processedWelcomesForDeviceRef.current === credential.deviceId) {
      return;
    }
    processedWelcomesForDeviceRef.current = credential.deviceId;

    engine.processPendingWelcomes().catch((error: unknown) => {
      console.warn('Could not process pending MLS welcomes', error);
    });
  }, [engine, credential]);

  return engine;
}
