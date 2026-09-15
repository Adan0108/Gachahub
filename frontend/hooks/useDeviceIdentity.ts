'use client';

import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from './useCurrentUser';
import { TsMlsDeviceIdentityStore } from '../lib/mls/tsMlsAdapter';
import { EncryptedIndexedDbDeviceIdentityStorage } from '../lib/mls/deviceIdentityStorage';
import { ensureDeviceProvisioned, revokeDeviceEverywhere } from '../lib/mls/deviceProvisioning';
import type { DeviceCredential } from '../lib/mls/types';

// One store per browser tab, reused across renders/hook instances - the
// underlying identity is still one-per-browser-profile (persisted in
// IndexedDB), this just avoids re-hydrating it from storage on every call.
let sharedStore: TsMlsDeviceIdentityStore | undefined;
function getSharedDeviceIdentityStore(): TsMlsDeviceIdentityStore {
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
    // Guards against duplicate provisioning attempts for the same user
    // (e.g. a second render before the first ensureDeviceProvisioned call
    // resolves) - not a lock against a second browser tab doing the same
    // thing concurrently, which the underlying storage already handles.
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
