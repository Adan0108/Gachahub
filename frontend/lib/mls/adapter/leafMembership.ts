import type { RatchetTree } from 'ts-mls';
import type { DeviceCredential, MembershipChange } from '../contract/types';
import { bytesToBase64 } from '../storage/base64';
import { decodeIdentity } from './identityCodec';

interface Leaf {
  /** Distinguishes leaves by identity AND signature key, so a device coming back under a different key reads as removed + added, not unchanged. */
  key: string;
  /** Undefined when the leaf's credential isn't a decodable basic credential. */
  credential: DeviceCredential | undefined;
}

function listLeaves(tree: RatchetTree): Leaf[] {
  const leaves: Leaf[] = [];

  for (const node of tree) {
    if (node?.nodeType !== 'leaf') continue;

    const { credential, signaturePublicKey } = node.leaf;
    const identity =
      credential.credentialType === 'basic' ? decodeIdentity(credential.identity) : undefined;
    const signatureKeyText = bytesToBase64(signaturePublicKey);

    leaves.push(
      identity
        ? {
            key: JSON.stringify([identity.userId, identity.deviceId, signatureKeyText]),
            credential: { ...identity, signatureKey: signaturePublicKey },
          }
        : { key: JSON.stringify(['undecodable', signatureKeyText]), credential: undefined },
    );
  }

  return leaves;
}

function countByKey(leaves: Leaf[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const leaf of leaves) {
    counts.set(leaf.key, (counts.get(leaf.key) ?? 0) + 1);
  }
  return counts;
}

/** Leaves of `from` beyond the copies `other` already has - a multiset difference, so the same device present twice is not collapsed into one. */
function leavesNotIn(from: Leaf[], other: Leaf[]): Leaf[] {
  const remaining = countByKey(other);

  return from.filter((leaf) => {
    const left = remaining.get(leaf.key) ?? 0;
    if (left > 0) {
      remaining.set(leaf.key, left - 1);
      return false;
    }
    return true;
  });
}

/**
 * Who joined and who left between two ratchet-tree snapshots, as device
 * identities. Returns undefined when a NEW leaf's credential can't be
 * decoded: reporting the delta without it would silently hide a member from
 * anything checking the commit against the server's declared roster. A
 * removed leaf that can't be decoded is simply omitted - it's gone, and
 * there is no identity to report.
 */
export function diffLeafMembership(
  before: RatchetTree,
  after: RatchetTree,
): MembershipChange | undefined {
  const beforeLeaves = listLeaves(before);
  const afterLeaves = listLeaves(after);

  const addedLeaves = leavesNotIn(afterLeaves, beforeLeaves);
  if (addedLeaves.some((leaf) => leaf.credential === undefined)) {
    return undefined;
  }

  return {
    added: addedLeaves.map((leaf) => leaf.credential!),
    removed: leavesNotIn(beforeLeaves, afterLeaves).flatMap((leaf) =>
      leaf.credential ? [leaf.credential] : [],
    ),
  };
}
