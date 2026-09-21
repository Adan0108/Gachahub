import { bytesEqual } from '../bytes';
import type { DeviceCredential, DeviceId, UserId } from '../contract/types';
import { base64ToBytes } from '../storage/base64';

/** A device the server records as in the group at some epoch. */
export interface RosterLeaf {
  deviceId: DeviceId;
  userId: UserId;
  /** Null when the device's record is gone, so there is no key left to compare. */
  signatureKey: Uint8Array | null;
}

/** Reads the backend's roster response; undefined for anything that isn't one, so a bad reply can't pass as an empty group. */
export function parseRoster(response: unknown): RosterLeaf[] | undefined {
  const leaves = (response as { leaves?: unknown } | null)?.leaves;
  if (!Array.isArray(leaves)) return undefined;

  const parsed: RosterLeaf[] = [];
  for (const leaf of leaves) {
    const { deviceId, userId, signaturePublicKey } = (leaf ?? {}) as Record<string, unknown>;
    if (typeof deviceId !== 'string' || typeof userId !== 'string') return undefined;
    if (signaturePublicKey !== null && typeof signaturePublicKey !== 'string') return undefined;

    try {
      parsed.push({
        deviceId,
        userId,
        signatureKey: signaturePublicKey === null ? null : base64ToBytes(signaturePublicKey),
      });
    } catch {
      return undefined;
    }
  }

  return parsed;
}

/**
 * Compares every leaf of a ratchet tree with the server's roster for the same
 * epoch: same devices, each owned by the user and carrying the key the server
 * has. The per-Commit check only keeps a tree honest if it started honest; this
 * is what covers the leaves the group was created with, and the whole tree a
 * Welcome hands a new member. Returns what differs, or undefined when it agrees.
 */
export function describeTreeMismatch(
  treeLeaves: DeviceCredential[] | undefined,
  roster: RosterLeaf[],
): string | undefined {
  if (!treeLeaves) return 'the group has a leaf whose credential cannot be read';

  const rosterByDevice = new Map(roster.map((leaf) => [leaf.deviceId, leaf]));
  const seen = new Set<DeviceId>();

  for (const leaf of treeLeaves) {
    const recorded = rosterByDevice.get(leaf.deviceId);

    if (!recorded) {
      return `the group has a leaf for ${leaf.deviceId}, which the server does not have in it`;
    }
    if (seen.has(leaf.deviceId)) {
      return `the group has more than one leaf for ${leaf.deviceId}`;
    }
    seen.add(leaf.deviceId);

    if (recorded.userId !== leaf.userId) {
      return `the leaf for ${leaf.deviceId} is labelled as user ${leaf.userId}, not the user the server recorded`;
    }
    if (recorded.signatureKey && !bytesEqual(recorded.signatureKey, leaf.signatureKey)) {
      return `the leaf for ${leaf.deviceId} does not carry that device's registered key`;
    }
  }

  const missing = roster.find((leaf) => !seen.has(leaf.deviceId));
  return missing
    ? `the server has ${missing.deviceId} in the group, but it has no leaf there`
    : undefined;
}
