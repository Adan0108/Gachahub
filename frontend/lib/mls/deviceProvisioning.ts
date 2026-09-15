import { api } from '../api';
import {
  CIPHERSUITE_NAME,
  TsMlsDeviceIdentityStore,
  extractKeyPackagePayload,
} from './tsMlsAdapter';
import { bytesToBase64 } from './base64';
import type { DeviceCredential, UserId } from './types';

/**
 * Uploaded alongside the one LAST_RESORT package on first provision, so the
 * device has real single-use packages to offer immediately instead of every
 * early Add falling back to the one package that's never supposed to be
 * consumed. Not a full replenishment scheduler (that's a later concern,
 * mirroring the backend's MlsKeyPackageCleanupService) - just enough supply
 * for a freshly provisioned device to be usable right away.
 */
const INITIAL_SINGLE_USE_KEY_PACKAGE_COUNT = 10;

/**
 * Ensures this browser device has a provisioned, backend-registered MLS
 * identity for `userId` - provisioning a new one only when needed. Not
 * exported as a hook itself (that's useDeviceIdentity.ts) so this can be
 * unit-tested without React.
 */
export async function ensureDeviceProvisioned(
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
    // profile"), so the old identity can't be reused for the new one.
    await store.revoke();
  }

  return provisionAndRegister(store, userId);
}

async function provisionAndRegister(
  store: TsMlsDeviceIdentityStore,
  userId: UserId,
): Promise<DeviceCredential> {
  const credential = await store.provision(userId);
  const envelopes = await store.generateKeyPackages(
    INITIAL_SINGLE_USE_KEY_PACKAGE_COUNT + 1,
  );
  const [lastResortEnvelope, ...singleUseEnvelopes] = envelopes;
  if (!lastResortEnvelope) {
    throw new Error('generateKeyPackages returned no key packages');
  }

  await api.registerChatDevice({
    deviceId: credential.deviceId,
    signaturePublicKey: bytesToBase64(credential.signatureKey),
    ciphersuite: CIPHERSUITE_NAME,
    keyPackages: [
      { kind: 'LAST_RESORT', payload: extractKeyPackagePayload(lastResortEnvelope) },
      ...singleUseEnvelopes.map((envelope) => ({
        kind: 'SINGLE_USE',
        payload: extractKeyPackagePayload(envelope),
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
 */
export async function revokeDeviceEverywhere(
  store: TsMlsDeviceIdentityStore,
): Promise<void> {
  const credential = await store.getOwnCredential();
  await api.revokeChatDevice(credential.deviceId);
  await store.revoke();
}
