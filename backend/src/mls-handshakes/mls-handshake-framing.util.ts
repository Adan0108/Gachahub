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
