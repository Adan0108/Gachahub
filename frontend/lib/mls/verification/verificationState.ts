import type { DeviceCredential, UserId } from '../contract/types';
import { fingerprintToHex } from './safetyNumber';

/** Verification follows the peer across every conversation, so it is keyed by the two users only. */
export interface PeerKey {
  ownUserId: UserId;
  peerUserId: UserId;
}

/** One peer device whose signature key the user has verified. */
export interface DeviceKey {
  deviceId: string;
  /** Hex of the device signature key. */
  signatureKey: string;
}

/** What this device remembers about one peer the user has compared numbers with. */
export interface PeerVerification extends PeerKey {
  devices: DeviceKey[];
}

export type VerificationStatus = 'unverified' | 'verified' | 'new-device' | 'changed';

/**
 * 'changed' when a verified device id now has another key; 'new-device' when some current device is
 * unverified but the peer was verified before; retired verified devices are ignored.
 */
export function statusOf(record: PeerVerification | undefined, current: DeviceKey[]): VerificationStatus {
  if (!record?.devices.length || !current.length) return 'unverified';
  const verified = new Map(record.devices.map((d) => [d.deviceId, d.signatureKey]));
  let unverified = false;
  for (const device of current) {
    const known = verified.get(device.deviceId);
    if (known !== undefined && known !== device.signatureKey) return 'changed';
    if (known === undefined) unverified = true;
  }
  return unverified ? 'new-device' : 'verified';
}

/** Adds (or replaces by device id) the given devices in the peer's verified set. */
export function markVerified(
  record: PeerVerification | undefined,
  key: PeerKey,
  current: DeviceKey[],
): PeerVerification {
  const replaced = new Set(current.map((d) => d.deviceId));
  const kept = (record?.devices ?? []).filter((d) => !replaced.has(d.deviceId));
  return { ownUserId: key.ownUserId, peerUserId: key.peerUserId, devices: [...kept, ...current] };
}

/** The user's devices in a group, with signature keys as hex. */
export function currentDeviceKeys(userId: UserId, leaves: DeviceCredential[]): DeviceKey[] {
  return leaves
    .filter((leaf) => leaf.userId === userId)
    .map((leaf) => ({ deviceId: leaf.deviceId, signatureKey: fingerprintToHex(leaf.signatureKey) }));
}
