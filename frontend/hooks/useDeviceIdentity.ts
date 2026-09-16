'use client';

import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from './useCurrentUser';
import { TsMlsDeviceIdentityStore } from '../lib/mls/adapter/tsMlsAdapter';
import { EncryptedIndexedDbDeviceIdentityStorage } from '../lib/mls/storage/deviceIdentityStorage';
import { ensureDeviceProvisioned, revokeDeviceEverywhere } from '../lib/mls/device/deviceProvisioning';
import type { DeviceCredential } from '../lib/mls/contract/types';

// One store per browser tab, reused across renders/hook instances - the
// underlying identity is still one-per-browser-profile (persisted in
// IndexedDB), this just avoids re-hydrating it from storage on every call.
// Exported so useSyncEngine.ts can build its GroupSessionFactory on top of
// the SAME store this hook already provisioned, not a second, unprovisioned one.
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
}

/**
 * Ensures the current browser device has a provisioned, backend-registered
 * MLS identity for the signed-in user, provisioning one on first use.
 * Doesn't do anything with conversations/groups - that's the sync engine
 * (stage 7), built on top of the credential this returns.
 */
export function useDeviceIdentity(): UseDeviceIdentityResult {
  const { user, isAuthenticated } = useCurrentUser();
  const [credential, setCredential] = useState<DeviceCredential | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const provisioningUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      return;
    }
    // Avoids an unnecessary re-render-triggered call for the same user on
    // this hook instance. ensureDeviceProvisioned itself also dedupes
    // concurrent calls sharing the same store (deviceProvisioning.ts) -
    // needed because this hook is mounted independently from several
    // places at once (AppShell, chat/page.jsx, useSyncEngine), so this ref
    // alone can't prevent every instance from calling it simultaneously.
    if (provisioningUserIdRef.current === user.id) {
      return;
    }
    provisioningUserIdRef.current = user.id;

    ensureDeviceProvisioned(getSharedDeviceIdentityStore(), user.id)
      .then(setCredential)
      .catch((caughtError: unknown) => {
        provisioningUserIdRef.current = undefined;
        setError(caughtError instanceof Error ? caughtError : new Error(String(caughtError)));
      });
  }, [isAuthenticated, user?.id]);

  async function revokeDevice(): Promise<void> {
    await revokeDeviceEverywhere(getSharedDeviceIdentityStore());
    provisioningUserIdRef.current = undefined;
    setCredential(undefined);
  }

  return { credential, isReady: credential !== undefined, error, revokeDevice };
}
