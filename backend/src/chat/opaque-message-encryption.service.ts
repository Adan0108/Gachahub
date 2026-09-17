import { Injectable } from '@nestjs/common';
import { ChatMessageContentType } from '../generated/prisma/client';
import { assertIsApplicationMessage } from '../mls-handshakes/mls-handshake-framing.util';
import { EncryptedMessagePayloadDto } from './dto/encrypted-message-payload.dto';
import {
  MessageEncryptionPort,
  PreparedEncryptedMessage,
} from './ports/message-encryption.port';

/**
 * The frontend's "start a new chat" flow sends this exact literal as
 * ciphertext for its placeholder SYSTEM message (see chat/page.jsx),
 * before any real MLS group exists yet to encrypt under. Matched
 * literally, not just by contentType: contentType is a client-supplied,
 * unrestricted enum field (EncryptedMessagePayloadDto), so exempting all
 * of SYSTEM from framing validation would let any client send
 * contentType: 'SYSTEM' with arbitrary non-MLS bytes as a real message,
 * which is exactly what this validation exists to block.
 */
const PENDING_MLS_SETUP_PLACEHOLDER = 'placeholder-pending-mls-setup';

/**
 * Preserves true client-side encryption - never decrypts or transforms the
 * payload. Does check that it's actually shaped like an MLS application
 * message, the protocol validation this port exists for: without it, a
 * commit/proposal mislabeled as chat content, or outright non-MLS bytes,
 * would be accepted and stored with only a length cap, unlike a handshake
 * commit (see mls-handshake-framing.util.ts).
 */
@Injectable()
export class OpaqueMessageEncryptionService implements MessageEncryptionPort {
  // async (no await needed) so a validation failure below always surfaces
  // as a rejected promise, matching the interface's contract, rather than
  // a synchronous throw a caller that doesn't immediately await this (e.g.
  // inside a Promise.all(...)) wouldn't be expecting.
  // eslint-disable-next-line @typescript-eslint/require-await
  async preparePayload(
    payload: EncryptedMessagePayloadDto,
    conversationId?: string,
  ): Promise<PreparedEncryptedMessage> {
    const isPendingSetupPlaceholder =
      payload.contentType === ChatMessageContentType.SYSTEM &&
      payload.ciphertext === PENDING_MLS_SETUP_PLACEHOLDER;

    if (!isPendingSetupPlaceholder) {
      // Same base64-decode-then-frame-check pattern as
      // MlsHandshakesService.submitHandshake - Buffer.from(_, 'base64')
      // doesn't throw on invalid input, it just decodes best-effort, so
      // garbage input surfaces as a normal "not a valid MLS message" from
      // assertIsApplicationMessage rather than needing its own try/catch.
      const ciphertextBytes = new Uint8Array(
        Buffer.from(payload.ciphertext, 'base64'),
      );
      assertIsApplicationMessage(ciphertextBytes, conversationId);
    }

    return {
      ciphertext: payload.ciphertext,
      encryptionMeta: payload.encryptionMeta,
    };
  }
}
