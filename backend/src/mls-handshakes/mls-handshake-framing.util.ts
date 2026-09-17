import { BadRequestException } from '@nestjs/common';
import { decodeMlsMessage, type MLSMessage } from 'ts-mls';
import { bytesEqual } from '../common/utils/bytes';

/**
 * Server-side framing checks - never decrypt anything, just confirm the
 * submitted bytes are shaped like what the endpoint claims they are.
 * group_id and content_type sit in MLS's plaintext PrivateMessage header
 * even though the body is encrypted, so the server can catch a client
 * mislabeling an application message as a commit, or submitting a commit
 * meant for a different conversation, without ever seeing message content
 * (threat-model: the server is a relay, not blind to protocol shape).
 *
 * Only mls_private_message is accepted - the frontend adapter never
 * produces mls_public_message (wireAsPublicMessage is never set), so
 * supporting it here would be untested surface with no real caller.
 */
export function assertIsCommitForConversation(
  payload: Uint8Array,
  conversationId: string,
  expectedEpoch: number,
): void {
  const decoded = decodeAndDescribe(payload);

  if (decoded.wireformat !== 'mls_private_message') {
    throw new BadRequestException(
      'Handshake payload must be an MLS private message',
    );
  }

  if (decoded.privateMessage.contentType !== 'commit') {
    throw new BadRequestException(
      'Handshake payload must have contentType "commit"',
    );
  }

  const expectedGroupId = new TextEncoder().encode(conversationId);
  if (!bytesEqual(decoded.privateMessage.groupId, expectedGroupId)) {
    throw new BadRequestException(
      'Handshake payload group_id does not match this conversation',
    );
  }

  // The caller-declared epoch drives the epoch compare-and-set
  // (MlsHandshakesRepository.acceptHandshake) - without cross-checking it
  // against the epoch actually embedded in this commit's plaintext framing,
  // a mislabeled epoch would be accepted and stored, permanently
  // desynchronizing every other member's local MLS state at that slot.
  if (decoded.privateMessage.epoch !== BigInt(expectedEpoch)) {
    throw new BadRequestException(
      'Handshake payload epoch does not match the declared epoch',
    );
  }
}

/**
 * Same class of check as assertIsCommitForConversation, for the one place
 * that argument doesn't cover: an application (chat) message's ciphertext,
 * which is currently accepted with no shape validation at all - only a
 * length cap. Catches a client mislabeling a commit/proposal as a chat
 * message, or sending non-MLS bytes outright.
 *
 * The group_id cross-check is optional (pass conversationId when it's
 * known) rather than mandatory like assertIsCommitForConversation's: a
 * brand-new conversation's first message is prepared before that
 * conversation's id even exists, so there's nothing yet to cross-check it
 * against there. Every other call site DOES know the conversationId and
 * must pass it - skipping it there would let a participant relay one
 * conversation's ciphertext into another (caught client-side as
 * "wrong-conversation" today, but the server shouldn't rely on that).
 */
export function assertIsApplicationMessage(
  payload: Uint8Array,
  conversationId?: string,
): void {
  const decoded = decodeAndDescribe(payload);

  if (decoded.wireformat !== 'mls_private_message') {
    throw new BadRequestException(
      'Message ciphertext must be an MLS private message',
    );
  }

  if (decoded.privateMessage.contentType !== 'application') {
    throw new BadRequestException(
      'Message ciphertext must have contentType "application"',
    );
  }

  if (conversationId !== undefined) {
    const expectedGroupId = new TextEncoder().encode(conversationId);
    if (!bytesEqual(decoded.privateMessage.groupId, expectedGroupId)) {
      throw new BadRequestException(
        'Message ciphertext group_id does not match this conversation',
      );
    }
  }
}

export function assertIsWelcomeMessage(payload: Uint8Array): void {
  const decoded = decodeAndDescribe(payload);

  if (decoded.wireformat !== 'mls_welcome') {
    throw new BadRequestException(
      'Welcome payload must be an MLS Welcome message',
    );
  }
}

function decodeAndDescribe(payload: Uint8Array): MLSMessage {
  let decoded: MLSMessage | undefined;
  try {
    decoded = decodeMlsMessage(payload, 0)?.[0];
  } catch {
    // ts-mls throws on truncated/malformed binary input rather than
    // returning undefined - same gap already fixed once in
    // mls-key-package.util.ts, applies equally here.
    decoded = undefined;
  }

  if (!decoded) {
    throw new BadRequestException('Not a valid MLS message');
  }

  return decoded;
}
