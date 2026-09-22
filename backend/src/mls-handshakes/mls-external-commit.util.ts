import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  type CiphersuiteImpl,
} from 'ts-mls';
// Not re-exported from the package root - reachable via ts-mls's own "./*.js" subpath export map.
import { verifyFramedContentSignature } from 'ts-mls/framedContent.js';
import { PINNED_CIPHERSUITE } from '../chat-devices/mls-key-package.util';

let cachedImpl: Promise<CiphersuiteImpl> | undefined;
function getImpl(): Promise<CiphersuiteImpl> {
  cachedImpl ??= getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
  return cachedImpl;
}
import { decodeMlsMessage } from 'ts-mls';
import { bytesEqual } from '../common/utils/bytes';

/** Who an external commit adds: read from the joiner's own leaf, so it is the joiner's claim until it is checked against the registry. */
export interface ExternalJoiner {
  userId: string;
  deviceId: string;
  signatureKey: Uint8Array;
}

/**
 * Reads a device's request to join a group by itself. An external commit is a
 * public message, so unlike other Commits the server can see what it does, and
 * insists on the one shape that is a plain join: a single ExternalInit
 * proposal and a path carrying the joiner's own leaf. Anything else, in
 * particular a Remove or Add riding along, is refused, so a joiner can only
 * ever add itself.
 */
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
  const [only] = proposals;
  if (
    proposals.length !== 1 ||
    only.proposalOrRefType !== 'proposal' ||
    only.proposal.proposalType !== 'external_init'
  ) {
    throw new BadRequestException(
      'A join commit must contain exactly one ExternalInit proposal',
    );
  }
  if (!path) {
    throw new BadRequestException('A join commit must carry the joiner leaf');
  }

  return {
    ...readIdentity(path.leafNode.credential),
    signatureKey: path.leafNode.signaturePublicKey,
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
  } catch {
    // falls through to the refusal below
  }
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

/**
 * RFC 9420 §6.1: a join commit is signed over the group context, which the
 * server holds in its stored snapshot. Verifying it here means a stolen login
 * alone (the device's PUBLIC key is in every roster response, its private key
 * is not) cannot submit a garbage join that every member would refuse - the
 * one move that would freeze the group.
 */
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
    (await getImpl()).signature,
  );

  if (!valid) {
    throw new ForbiddenException(
      'The join commit is not signed by this device',
    );
  }
}
