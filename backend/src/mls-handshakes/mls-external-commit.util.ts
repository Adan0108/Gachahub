import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { decodeMlsMessage } from 'ts-mls';
import { ratchetTreeFromExtension } from 'ts-mls/groupInfo.js';
import { leafToNodeIndex, type LeafIndex } from 'ts-mls/treemath.js';
// Not re-exported from the package root - reachable via ts-mls's own "./*.js" subpath export map.
import { verifyFramedContentSignature } from 'ts-mls/framedContent.js';
import { bytesEqual } from '../common/utils/bytes';
import { getPinnedCiphersuiteImpl } from '../common/utils/mls-pinned-ciphersuite';

/** Who an external commit adds: read from the joiner's own leaf, so it is the joiner's claim until it is checked against the registry. */
export interface ExternalJoiner {
  userId: string;
  deviceId: string;
  signatureKey: Uint8Array;
  /** Set when the commit also removes a leaf: a device replacing its own old one. */
  removedLeafIndex?: number;
}

/** Reads a device's request to join by itself; accepts one ExternalInit, plus at most one Remove (its own old leaf), with a path carrying the joiner's own leaf. */
export function readExternalJoin(
  payload: Uint8Array,
  conversationId: string,
  expectedEpoch: number,
): ExternalJoiner {
  let decoded: ReturnType<typeof decodeMlsMessage>;
  try {
    decoded = decodeMlsMessage(payload, 0);
  } catch {
    throw new BadRequestException('Join commit is not a valid MLS message');
  }

  const message = decoded?.[0];
  if (message?.wireformat !== 'mls_public_message') {
    throw new BadRequestException(
      'A join commit must be an MLS public message',
    );
  }

  const { content } = message.publicMessage;
  if (
    content.sender.senderType !== 'new_member_commit' ||
    content.contentType !== 'commit'
  ) {
    throw new BadRequestException('Expected a commit from a new member');
  }
  if (!bytesEqual(content.groupId, new TextEncoder().encode(conversationId))) {
    throw new BadRequestException(
      'Join commit group_id does not match this conversation',
    );
  }
  if (content.epoch !== BigInt(expectedEpoch)) {
    throw new BadRequestException(
      'Join commit epoch does not match the declared epoch',
    );
  }

  const { proposals, path } = content.commit;
  const inits = proposals.filter(
    (entry) =>
      entry.proposalOrRefType === 'proposal' &&
      entry.proposal.proposalType === 'external_init',
  );
  const removes = proposals.flatMap((entry) =>
    entry.proposalOrRefType === 'proposal' &&
    entry.proposal.proposalType === 'remove'
      ? [entry.proposal.remove.removed]
      : [],
  );
  if (
    inits.length !== 1 ||
    removes.length > 1 ||
    proposals.length !== inits.length + removes.length
  ) {
    throw new BadRequestException(
      'A join commit must contain exactly one ExternalInit proposal, and at most one Remove of its own old leaf',
    );
  }
  if (!path) {
    throw new BadRequestException('A join commit must carry the joiner leaf');
  }

  return {
    ...readIdentity(path.leafNode.credential),
    signatureKey: path.leafNode.signaturePublicKey,
    ...(removes.length === 1 ? { removedLeafIndex: Number(removes[0]) } : {}),
  };
}

function readIdentity(credential: {
  credentialType: string;
  identity?: Uint8Array;
}): {
  userId: string;
  deviceId: string;
} {
  if (credential.credentialType !== 'basic' || !credential.identity) {
    throw new BadRequestException(
      'The joiner leaf must carry a basic credential',
    );
  }

  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(credential.identity),
    ) as {
      userId?: unknown;
      deviceId?: unknown;
    };
    if (
      typeof parsed.userId === 'string' &&
      typeof parsed.deviceId === 'string'
    ) {
      return { userId: parsed.userId, deviceId: parsed.deviceId };
    }
  } catch {}
  throw new BadRequestException('The joiner leaf identity is not readable');
}

/** The leaf in the join commit must be the calling user's registered device, carrying its registered key. */
export function assertJoinerMatchesDevice(
  joiner: ExternalJoiner,
  expected: {
    userId: string;
    deviceId: string;
    signaturePublicKey: Uint8Array;
  },
): void {
  if (
    joiner.userId !== expected.userId ||
    joiner.deviceId !== expected.deviceId ||
    !bytesEqual(joiner.signatureKey, expected.signaturePublicKey)
  ) {
    throw new ForbiddenException(
      'The join commit is not for this device and its registered key',
    );
  }
}

/** RFC 9420 §6.1: verifies the join commit's signature against the group context in the stored snapshot. */
export async function assertExternalJoinSigned(
  commitPayload: Uint8Array,
  storedGroupInfoPayload: Uint8Array,
  signaturePublicKey: Uint8Array,
): Promise<void> {
  const commit = decodeMlsMessage(commitPayload, 0)?.[0];
  const snapshot = decodeMlsMessage(storedGroupInfoPayload, 0)?.[0];
  if (
    commit?.wireformat !== 'mls_public_message' ||
    snapshot?.wireformat !== 'mls_group_info'
  ) {
    throw new BadRequestException('Cannot verify this join commit');
  }

  const valid = await verifyFramedContentSignature(
    signaturePublicKey,
    'mls_public_message',
    commit.publicMessage.content,
    commit.publicMessage.auth,
    snapshot.groupInfo.groupContext,
    (await getPinnedCiphersuiteImpl()).signature,
  );

  if (!valid) {
    throw new ForbiddenException(
      'The join commit is not signed by this device',
    );
  }
}

/** A resync may only replace the calling device's own leaf: the leaf at that index in the stored snapshot must be this device, with its registered key. */
export function assertRemovedLeafIsJoiner(
  removedLeafIndex: number,
  storedGroupInfoPayload: Uint8Array,
  expected: {
    userId: string;
    deviceId: string;
    signaturePublicKey: Uint8Array;
  },
): void {
  const snapshot = decodeMlsMessage(storedGroupInfoPayload, 0)?.[0];
  if (snapshot?.wireformat !== 'mls_group_info') {
    throw new BadRequestException('Cannot verify this join commit');
  }
  const tree = ratchetTreeFromExtension(snapshot.groupInfo);
  if (!tree) {
    throw new BadRequestException(
      'The stored snapshot carries no ratchet_tree',
    );
  }

  const node = tree[leafToNodeIndex(removedLeafIndex as LeafIndex)];
  if (node?.nodeType !== 'leaf') {
    throw new BadRequestException('The removed leaf is not in this group');
  }

  const leaf = readIdentity(node.leaf.credential);
  if (
    leaf.userId !== expected.userId ||
    leaf.deviceId !== expected.deviceId ||
    !bytesEqual(node.leaf.signaturePublicKey, expected.signaturePublicKey)
  ) {
    throw new ForbiddenException(
      'A join may only replace the leaf of the device that is joining',
    );
  }
}
