import type { DeviceCredential, UserId } from '../contract/types';
import { fingerprintFromLeaves, formatSafetyNumber, pairFingerprint } from './safetyNumber';
import type { VerifiedPeerStore } from './verifiedPeerStore';
import {
  currentDeviceKeys,
  markVerified,
  statusOf,
  type DeviceKey,
  type PeerKey,
  type VerificationStatus,
} from './verificationState';

export interface PeerSafety {
  status: VerificationStatus;
  /** The peer's current devices in this conversation; recorded on verify. */
  devices: DeviceKey[];
  yourNumber?: string;
  theirNumber?: string;
  /** The number both sides compare. */
  pairNumber?: string;
}

/** Computes each peer's status and numbers from this conversation's local leaves; reads only. */
export async function computePeerSafety(
  store: VerifiedPeerStore,
  ownUserId: UserId,
  peerIds: UserId[],
  leaves: DeviceCredential[] | undefined,
): Promise<Record<UserId, PeerSafety>> {
  const own = leaves && (await fingerprintFromLeaves(ownUserId, leaves));
  const result: Record<UserId, PeerSafety> = {};

  for (const peerId of peerIds) {
    const devices = leaves ? currentDeviceKeys(peerId, leaves) : [];
    const record = await store.get({ ownUserId, peerUserId: peerId });
    result[peerId] = { status: statusOf(record, devices), devices };
    const theirs = leaves && (await fingerprintFromLeaves(peerId, leaves));
    if (theirs && own) {
      result[peerId].yourNumber = formatSafetyNumber(own);
      result[peerId].theirNumber = formatSafetyNumber(theirs);
      result[peerId].pairNumber = formatSafetyNumber(await pairFingerprint(own, theirs));
    }
  }
  return result;
}

/** Records the peer's given devices as verified, keeping their earlier verified devices. */
export async function verifyPeer(
  store: VerifiedPeerStore,
  key: PeerKey,
  devices: DeviceKey[],
): Promise<void> {
  await store.save(markVerified(await store.get(key), key, devices));
}
