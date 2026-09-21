'use client';

import { useEffect } from 'react';
import { useDeviceIdentity, getSharedDeviceIdentityStore } from './useDeviceIdentity';
import { TsMlsGroupSessionFactory } from '../lib/mls/adapter/tsMlsAdapter';
import { SyncEngine } from '../lib/mls/sync/syncEngine';
import type { DeviceId, UserId } from '../lib/mls/contract/types';

// One engine per browser tab per device, reused across hook instances - a
// second SyncEngine wrapping the same store would just duplicate the
// in-memory session cache/locks for no benefit. Getting/creating it does
// mutate this module-level state, but only that - no network, no timers,
// no DOM - so it's safe to call directly from render the way a lazy
// singleton normally is (same shape as getSharedDeviceIdentityStore),
// unlike the polling setup below, which is a real side effect and belongs
// in the effect further down.
let sharedEngine: SyncEngine | undefined;
let sharedEngineDeviceId: DeviceId | undefined;

function ensureSharedSyncEngine(deviceId: DeviceId, userId: UserId): SyncEngine {
  if (!sharedEngine || sharedEngineDeviceId !== deviceId) {
    const factory = new TsMlsGroupSessionFactory(getSharedDeviceIdentityStore());
    sharedEngine = new SyncEngine(factory, deviceId, userId);
    sharedEngineDeviceId = deviceId;
  }
  return sharedEngine;
}

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

// Reference-counted so several components can call useSyncEngine() for the
// same engine (AppShell, chat/page.jsx, ...) and still share exactly one
// interval - tied to how many mounted consumers currently want it, not to
// any single one of their lifecycles. The engine argument identifies which
// generation this is polling for, so a device-identity change (a new
// engine) correctly starts a fresh interval instead of reusing a stale one.
let pollConsumerCount = 0;
let pollIntervalId: ReturnType<typeof setInterval> | undefined;
let pollingEngine: SyncEngine | undefined;

function startWelcomePolling(engine: SyncEngine): void {
  pollConsumerCount += 1;
  if (pollingEngine === engine && pollIntervalId !== undefined) {
    return;
  }
  if (pollIntervalId !== undefined) {
    clearInterval(pollIntervalId);
  }
  pollingEngine = engine;
  checkForPendingWelcomes(engine);
  pollIntervalId = setInterval(() => checkForPendingWelcomes(engine), WELCOME_POLL_INTERVAL_MS);
}

// Takes the engine it registered for (not just "one fewer consumer") so
// this is correct by construction rather than by relying on React always
// running effect cleanups/re-setups in a particular order: a stale
// consumer cleaning up after a newer engine has already taken over
// polling has nothing to do here, whatever pollConsumerCount currently is.
function stopWelcomePollingConsumer(engine: SyncEngine): void {
  if (pollingEngine !== engine) {
    return;
  }
  pollConsumerCount = Math.max(0, pollConsumerCount - 1);
  if (pollConsumerCount === 0 && pollIntervalId !== undefined) {
    clearInterval(pollIntervalId);
    pollIntervalId = undefined;
    pollingEngine = undefined;
  }
}

/**
 * Returns this device's SyncEngine once its MLS identity is provisioned -
 * undefined until then, since a SyncEngine is meaningless without a
 * deviceId. Also polls for pending Welcomes for as long as at least one
 * component is mounted with this device identity active (e.g. after being
 * added to a new conversation).
 */
export function useSyncEngine(): SyncEngine | undefined {
  const { credential, isReady } = useDeviceIdentity();
  const engine =
    isReady && credential
      ? ensureSharedSyncEngine(credential.deviceId, credential.userId)
      : undefined;

  useEffect(() => {
    if (!engine) {
      return undefined;
    }
    startWelcomePolling(engine);
    return () => stopWelcomePollingConsumer(engine);
  }, [engine]);

  return engine;
}
