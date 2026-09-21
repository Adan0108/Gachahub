import { api } from '../../api';
import { CIPHERSUITE_NAME, TsMlsDeviceIdentityStore } from '../adapter/tsMlsAdapter';
import { bytesToBase64 } from '../storage/base64';
import type { DeviceCredential, UserId } from '../contract/types';

/**
 * Uploaded alongside the one LAST_RESORT package on first provision, so the
 * device has real single-use packages to offer immediately instead of every
 * early Add falling back to the one package that's never supposed to be
 * consumed. Not a full replenishment scheduler (that's a later concern,
 * mirroring the backend's MlsKeyPackageCleanupService) - just enough supply
 * for a freshly provisioned device to be usable right away.
 */
const INITIAL_SINGLE_USE_KEY_PACKAGE_COUNT = 10;

/** lib/api.js (plain JS, untyped) attaches the HTTP status to every thrown request error. */
interface ApiError extends Error {
  status?: number;
}

// Keyed by store instance (not userId alone) so unrelated store instances -
// e.g. in tests - never share an in-flight entry. Without this, several
// hook instances (useDeviceIdentity is mounted independently from AppShell,
// chat/page.jsx, and useSyncEngine) can all observe "not yet provisioned"
// before the first call resolves and each provision + register a distinct
// device with the backend, silently orphaning every loser.
const inFlightProvisioning = new WeakMap<
  TsMlsDeviceIdentityStore,
  { userId: UserId; promise: Promise<DeviceCredential> }
>();

/**
 * Ensures this browser device has a provisioned, backend-registered MLS
 * identity for `userId` - provisioning a new one only when needed. Not
 * exported as a hook itself (that's useDeviceIdentity.ts) so this can be
 * unit-tested without React.
 */
export function ensureDeviceProvisioned(
  store: TsMlsDeviceIdentityStore,
  userId: UserId,
): Promise<DeviceCredential> {
  const inFlight = inFlightProvisioning.get(store);
  if (inFlight && inFlight.userId === userId) {
    return inFlight.promise;
  }

  const promise = ensureDeviceProvisionedUnsafe(store, userId).finally(() => {
    if (inFlightProvisioning.get(store)?.promise === promise) {
      inFlightProvisioning.delete(store);
    }
  });
  inFlightProvisioning.set(store, { userId, promise });
  return promise;
}

async function ensureDeviceProvisionedUnsafe(
  store: TsMlsDeviceIdentityStore,
  userId: UserId,
): Promise<DeviceCredential> {
  const credential = await provisionIfNeeded(store, userId);
  await linkSession(credential);
  return credential;
}

/** Best effort: a failure only means revoking this device would not end this login. */
async function linkSession(credential: DeviceCredential): Promise<void> {
  try {
    await api.linkChatDeviceSession(credential.deviceId);
  } catch (error) {
    console.warn('Could not link this login to its device', error);
  }
}

async function provisionIfNeeded(
  store: TsMlsDeviceIdentityStore,
  userId: UserId,
): Promise<DeviceCredential> {
  if (await store.isProvisioned()) {
    const existing = await store.getOwnCredential();
    if (existing.userId === userId) {
      return existing;
    }
    // A different user signed into this browser profile - device identity
    // is per-user (client.ts: "one instance per logged-in user per browser
    // profile"), so the old identity can't be reused for the new one. Must
    // go through the backend-then-local revoke, not a local-only wipe -
    // otherwise the old device stays ACTIVE and claimable on the backend
    // forever, with nothing left in this browser profile able to revoke it.
    await revokeDeviceEverywhere(store);
  }

  return provisionAndRegister(store, userId);
}

async function provisionAndRegister(
  store: TsMlsDeviceIdentityStore,
  userId: UserId,
): Promise<DeviceCredential> {
  const credential = await store.provision(userId);
  const [lastResortKeyPackage] = await store.generateKeyPackages(1, 'LAST_RESORT');
  const singleUseKeyPackages = await store.generateKeyPackages(
    INITIAL_SINGLE_USE_KEY_PACKAGE_COUNT,
    'SINGLE_USE',
  );
  if (!lastResortKeyPackage) {
    throw new Error('generateKeyPackages returned no key packages');
  }

  await api.registerChatDevice({
    deviceId: credential.deviceId,
    signaturePublicKey: bytesToBase64(credential.signatureKey),
    ciphersuite: CIPHERSUITE_NAME,
    keyPackages: [
      { kind: 'LAST_RESORT', payload: bytesToBase64(lastResortKeyPackage) },
      ...singleUseKeyPackages.map((keyPackage) => ({
        kind: 'SINGLE_USE',
        payload: bytesToBase64(keyPackage),
      })),
    ],
  });

  return credential;
}

/**
 * Revokes this device everywhere. The backend call must succeed before
 * local keys are destroyed - the reverse order would strand the device as
 * "revoked" locally while the backend still treats it as active and
 * claimable, with no way to use this device's identity again to fix it.
 *
 * A 404 is the one exception: it means the backend already has no record of
 * this device (e.g. the account it belonged to was deleted outright, taking
 * the device with it via cascade - routine with the dev test-user tooling).
 * There is nothing left to notify the backend about, so this is a success
 * case for "everywhere," not a failure - treating it as an error would
 * permanently wedge ensureDeviceProvisioned's user-switch path, since the
 * stale local credential this browser still holds can never be revoked
 * again through a device row that no longer exists.
 */
export async function revokeDeviceEverywhere(store: TsMlsDeviceIdentityStore): Promise<void> {
  const credential = await store.getOwnCredential();
  try {
    await api.revokeChatDevice(credential.deviceId);
  } catch (error) {
    if (!(error instanceof Error) || (error as ApiError).status !== 404) {
      throw error;
    }
  }
  await store.revoke();
}
