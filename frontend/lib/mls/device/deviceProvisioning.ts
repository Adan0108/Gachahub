import { api } from '../../api';
import { CIPHERSUITE_NAME, TsMlsDeviceIdentityStore } from '../adapter/tsMlsAdapter';
import { bytesToBase64 } from '../storage/base64';
import { generateKeyPackageUploads, SINGLE_USE_BATCH_SIZE } from './keyPackageBatch';
import { wipeAllLocalMlsSecrets, wipeGroupSessionState } from '../storage/mlsEncryptedStore';
import type { DeviceCredential, UserId } from '../contract/types';

/** lib/api.js (plain JS, untyped) attaches the HTTP status to every thrown request error. */
interface ApiError extends Error {
  status?: number;
  code?: string;
}

/** The backend's codes for a device that is retired or unknown; a bare 404 (proxy, deploy) must never count. */
const DEVICE_REVOKED = 'DEVICE_REVOKED';
const DEVICE_NOT_FOUND = 'DEVICE_NOT_FOUND';

// Keyed by store instance (not userId alone) so unrelated store instances - e.g. in tests - never share an in-flight entry
const inFlightProvisioning = new WeakMap<
  TsMlsDeviceIdentityStore,
  { userId: UserId; promise: Promise<DeviceCredential> }
>();

/** Ensures this browser device has a provisioned, backend-registered MLS identity for `userId` - provisioning a new one only when needed */
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
  if ((await linkSession(store, credential)) !== 'device-gone') return credential;

  // The server retired this identity (e.g. dormant for months): replace it in place
  await store.revoke();
  await wipeGroupSessionState();
  const fresh = await provisionAndRegister(store, userId);
  await linkSession(store, fresh);
  return fresh;
}

/** Proves to the server that this login is in this device, so signing the device out ends the login */
async function linkSession(
  store: TsMlsDeviceIdentityStore,
  credential: DeviceCredential,
): Promise<'linked' | 'failed' | 'device-gone'> {
  try {
    const response = (await api.chatDeviceSessionChallenge(credential.deviceId)) as {
      challenge?: string;
      alreadyLinked?: boolean;
    };
    if (response.alreadyLinked || !response.challenge) return 'linked';

    const { challenge } = response;
    const signature = await store.signSessionLinkChallenge(challenge);
    await api.linkChatDeviceSession(credential.deviceId, {
      challenge,
      signature: bytesToBase64(signature),
    });
    return 'linked';
  } catch (error) {
    const { code } = error as ApiError;
    if (code === DEVICE_REVOKED || code === DEVICE_NOT_FOUND) return 'device-gone';

    console.warn('Could not link this login to its device', error);
    return 'failed';
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
    // A different user signed into this browser profile - device identity is per-user (client.ts: "one instance per logged-in user per browser profile"), so the old identity can't be reused for the new one
    await revokeDeviceEverywhere(store);
    await wipeAllLocalMlsSecrets();
  }

  return provisionAndRegister(store, userId);
}

async function provisionAndRegister(
  store: TsMlsDeviceIdentityStore,
  userId: UserId,
): Promise<DeviceCredential> {
  const credential = await store.provision(userId);
  // Real single-use packages up front, so early Adds don't all fall back to the one reusable package
  const keyPackages = await generateKeyPackageUploads(store, {
    singleUse: SINGLE_USE_BATCH_SIZE,
    lastResort: true,
  });

  await api.registerChatDevice({
    deviceId: credential.deviceId,
    signaturePublicKey: bytesToBase64(credential.signatureKey),
    ciphersuite: CIPHERSUITE_NAME,
    keyPackages,
  });

  return credential;
}

/** Revokes this device everywhere */
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
