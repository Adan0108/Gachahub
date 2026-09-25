import { BadRequestException } from '@nestjs/common';
import { decodeMlsMessage } from 'ts-mls';
import {
  ratchetTreeFromExtension,
  verifyGroupInfoSignature,
} from 'ts-mls/groupInfo.js';
import { getSignaturePublicKeyFromLeafIndex } from 'ts-mls/ratchetTree.js';
import type { LeafIndex } from 'ts-mls/treemath.js';
import { bytesEqual } from '../common/utils/bytes';
import { getPinnedCiphersuiteImpl } from '../common/utils/mls-pinned-ciphersuite';

/**
 * A GroupInfo is the public snapshot a device joins from, so what the server
 * hands out must at least be one, for this conversation, at the epoch it says.
 * A joining device checks the tree inside it against the server's roster before
 * it acts; the signature is checked separately by assertGroupInfoSignedBy.
 */
export function assertIsGroupInfoFor(
  payload: Uint8Array,
  conversationId: string,
  epoch: number,
): void {
  let decoded: ReturnType<typeof decodeMlsMessage>;
  try {
    decoded = decodeMlsMessage(payload, 0);
  } catch {
    throw new BadRequestException('GroupInfo is not a valid MLS message');
  }

  const message = decoded?.[0];
  if (message?.wireformat !== 'mls_group_info') {
    throw new BadRequestException('Expected an MLS GroupInfo message');
  }

  const { groupContext } = message.groupInfo;
  if (
    !bytesEqual(groupContext.groupId, new TextEncoder().encode(conversationId))
  ) {
    throw new BadRequestException(
      'GroupInfo group_id does not match this conversation',
    );
  }
  if (groupContext.epoch !== BigInt(epoch)) {
    throw new BadRequestException(
      'GroupInfo epoch is not the epoch this commit creates',
    );
  }
}

/** RFC 9420 12.4.3: the snapshot must be signed by the publishing device's registered key, held by a leaf of its own tree. */
export async function assertGroupInfoSignedBy(
  payload: Uint8Array,
  publisherSignatureKey: Uint8Array,
): Promise<void> {
  const message = decodeMlsMessage(payload, 0)?.[0];
  if (message?.wireformat !== 'mls_group_info') {
    throw new BadRequestException('Expected an MLS GroupInfo message');
  }
  const { groupInfo } = message;

  const tree = ratchetTreeFromExtension(groupInfo);
  if (!tree) {
    throw new BadRequestException('GroupInfo carries no ratchet_tree');
  }

  let signerKey: Uint8Array;
  try {
    signerKey = getSignaturePublicKeyFromLeafIndex(
      tree,
      groupInfo.signer as LeafIndex,
    );
  } catch {
    throw new BadRequestException('GroupInfo signer is not a leaf of its tree');
  }
  if (!bytesEqual(signerKey, publisherSignatureKey)) {
    throw new BadRequestException('GroupInfo signer is not the publisher');
  }

  const impl = await getPinnedCiphersuiteImpl();
  if (!(await verifyGroupInfoSignature(groupInfo, signerKey, impl.signature))) {
    throw new BadRequestException('GroupInfo signature is invalid');
  }
}
