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

// One engine per tab per device, shared across hook instances.
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

// Polls for pending Welcomes so a device added while open can join.
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

// Reference-counted so consumers share one poll loop per engine.
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

// Takes the engine it registered for; a stale consumer's cleanup is a no-op.
function stopWelcomePollingConsumer(engine: SyncEngine): void {
  if (!pollConsumers.release(engine) || !activeLoop) return;

  stopLoop(activeLoop);
  activeLoop = undefined;
}

/** This device's SyncEngine once its identity is provisioned (undefined until then); polls for pending Welcomes while mounted. */
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
