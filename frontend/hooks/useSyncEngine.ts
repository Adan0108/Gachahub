'use client';

import { useEffect } from 'react';
import { useDeviceIdentity, getSharedDeviceIdentityStore } from './useDeviceIdentity';
import { TsMlsGroupSessionFactory } from '../lib/mls/adapter/tsMlsAdapter';
import { SyncEngine } from '../lib/mls/sync/syncEngine';
import { nextReconcileScope } from '../lib/mls/sync/reconcileSchedule';
import { pollDelayMs } from '../lib/mls/sync/pollBackoff';
import { PollConsumers } from '../lib/mls/sync/pollConsumers';
import { membershipEventLog } from '../lib/mls/sync/sharedMembershipEventLog';
import { KeyPackageReplenisher } from '../lib/mls/device/keyPackageReplenisher';
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
    // The old engine's wipe listener must not outlive it.
    sharedEngine?.dispose();
    const store = getSharedDeviceIdentityStore();
    const factory = new TsMlsGroupSessionFactory(store);
    sharedEngine = new SyncEngine(
      factory,
      deviceId,
      userId,
      undefined,
      new KeyPackageReplenisher(store, deviceId),
      membershipEventLog,
    );
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

// Everything one poll loop remembers; a new engine gets a new loop, so none of it carries over.
interface PollLoop {
  engine: SyncEngine;
  lastFullReconcileAt: number | null;
  consecutiveErrors: number;
  stopped: boolean;
  timeoutId: ReturnType<typeof setTimeout> | undefined;
}

async function checkForPendingWork(loop: PollLoop): Promise<void> {
  const scope = nextReconcileScope(Date.now(), loop.lastFullReconcileAt, document.hidden);
  if (!scope) return;

  try {
    await loop.engine.processPendingMlsWork(scope);
    // Only a run that finished counts as a full reconcile; a failed one is retried at the next poll.
    if (scope === 'full') loop.lastFullReconcileAt = Date.now();
    loop.consecutiveErrors = 0;
  } catch (error) {
    loop.consecutiveErrors += 1;
    console.warn('Could not process pending MLS work', error);
  }
}

// Reference-counted so several components can call useSyncEngine() for the
// same engine (AppShell, chat/page.jsx, ...) and still share exactly one
// poll loop - tied to how many mounted consumers currently want it, not to
// any single one of their lifecycles. The count is per engine: a
// device-identity change (a new engine) starts a fresh loop and count
// instead of reusing a stale one.
const pollConsumers = new PollConsumers<SyncEngine>();
let activeLoop: PollLoop | undefined;

function schedulePoll(loop: PollLoop, delayMs: number): void {
  loop.timeoutId = setTimeout(() => {
    void checkForPendingWork(loop).then(() => {
      if (loop.stopped) return;
      schedulePoll(loop, pollDelayMs(WELCOME_POLL_INTERVAL_MS, loop.consecutiveErrors));
    });
  }, delayMs);
}

function stopLoop(loop: PollLoop): void {
  loop.stopped = true;
  clearTimeout(loop.timeoutId);
}

function startWelcomePolling(engine: SyncEngine): void {
  if (!pollConsumers.acquire(engine)) return;

  if (activeLoop) stopLoop(activeLoop);
  activeLoop = {
    engine,
    lastFullReconcileAt: null,
    consecutiveErrors: 0,
    stopped: false,
    timeoutId: undefined,
  };
  schedulePoll(activeLoop, 0);
}

// Takes the engine it registered for, so a stale consumer cleaning up after a
// newer engine has already taken over polling has nothing to do here.
function stopWelcomePollingConsumer(engine: SyncEngine): void {
  if (!pollConsumers.release(engine) || !activeLoop) return;

  stopLoop(activeLoop);
  activeLoop = undefined;
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
