'use client';

import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from './useCurrentUser';
import { TsMlsDeviceIdentityStore } from '../lib/mls/adapter/tsMlsAdapter';
import { EncryptedIndexedDbDeviceIdentityStorage } from '../lib/mls/storage/deviceIdentityStorage';
import { ensureDeviceProvisioned, revokeDeviceEverywhere } from '../lib/mls/device/deviceProvisioning';
import type { DeviceCredential } from '../lib/mls/contract/types';

// One store per browser tab; exported so useSyncEngine builds on the same one.
let sharedStore: TsMlsDeviceIdentityStore | undefined;
export function getSharedDeviceIdentityStore(): TsMlsDeviceIdentityStore {
  sharedStore ??= new TsMlsDeviceIdentityStore(new EncryptedIndexedDbDeviceIdentityStorage());
  return sharedStore;
}

interface UseDeviceIdentityResult {
  credential: DeviceCredential | undefined;
  isReady: boolean;
  error: Error | undefined;
  /** "Log out this device everywhere" - irreversible, never call this on an ordinary logout. */
  revokeDevice: () => Promise<void>;
  /** Re-attempts provisioning after a failure, without needing a full page reload. */
  retry: () => void;
  /** Re-runs provisioning and returns the fresh credential; never rejects (a failure lands in `error`). */
  reprovision: () => Promise<DeviceCredential | undefined>;
}

/** Ensures this browser device has a provisioned, backend-registered MLS identity for the signed-in user. */
export function useDeviceIdentity(): UseDeviceIdentityResult {
  const { user, isAuthenticated } = useCurrentUser();
  const [credential, setCredential] = useState<DeviceCredential | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  // Bumped to re-run the effect for the same user after a failed attempt.
  const [attempt, setAttempt] = useState(0);
  const provisioningUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      return;
    }
    // Skips repeat calls for the same user on this hook instance.
    if (provisioningUserIdRef.current === user.id) {
      return;
    }
    provisioningUserIdRef.current = user.id;
    setError(undefined);

    ensureDeviceProvisioned(getSharedDeviceIdentityStore(), user.id)
      .then(setCredential)
      .catch((caughtError: unknown) => {
        provisioningUserIdRef.current = undefined;
        setError(caughtError instanceof Error ? caughtError : new Error(String(caughtError)));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attempt is a pure retry trigger, not a real dependency
  }, [isAuthenticated, user?.id, attempt]);

  async function revokeDevice(): Promise<void> {
    await revokeDeviceEverywhere(getSharedDeviceIdentityStore());
    provisioningUserIdRef.current = undefined;
    setCredential(undefined);
  }

  function retry(): void {
    provisioningUserIdRef.current = undefined;
    setAttempt((current) => current + 1);
  }

  async function reprovision(): Promise<DeviceCredential | undefined> {
    if (!user?.id) {
      setError(new Error('Cannot reprovision a device with no signed-in user'));
      return undefined;
    }
    try {
      const fresh = await ensureDeviceProvisioned(getSharedDeviceIdentityStore(), user.id);
      setCredential(fresh);
      setError(undefined);
      provisioningUserIdRef.current = user.id;
      return fresh;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError : new Error(String(caughtError)));
      return undefined;
    }
  }

  return {
    credential,
    isReady: credential !== undefined,
    error,
    revokeDevice,
    retry,
    reprovision,
  };
}
