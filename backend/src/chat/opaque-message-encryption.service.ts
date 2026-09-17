import { Injectable } from '@nestjs/common';
import { ChatMessageContentType } from '../generated/prisma/client';
import { assertIsApplicationMessage } from '../mls-handshakes/mls-handshake-framing.util';
import { EncryptedMessagePayloadDto } from './dto/encrypted-message-payload.dto';
import {
  MessageEncryptionPort,
  PreparedEncryptedMessage,
} from './ports/message-encryption.port';

/**
 * Preserves true client-side encryption - never decrypts or transforms the
 * payload. Does check that it's actually shaped like an MLS application
 * message, the protocol validation this port exists for: without it, a
 * commit/proposal mislabeled as chat content, or outright non-MLS bytes,
 * would be accepted and stored with only a length cap, unlike a handshake
 * commit (see mls-handshake-framing.util.ts).
 *
 * SYSTEM is the one contentType this deliberately skips: the frontend's
 * "start a new chat" flow sends a literal placeholder string as ciphertext
 * for it (see chat/page.jsx), before any real MLS group exists yet to
 * encrypt under.
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
  ): Promise<PreparedEncryptedMessage> {
    if (payload.contentType !== ChatMessageContentType.SYSTEM) {
      // Same base64-decode-then-frame-check pattern as
      // MlsHandshakesService.submitHandshake - Buffer.from(_, 'base64')
      // doesn't throw on invalid input, it just decodes best-effort, so
      // garbage input surfaces as a normal "not a valid MLS message" from
      // assertIsApplicationMessage rather than needing its own try/catch.
      const ciphertextBytes = new Uint8Array(
        Buffer.from(payload.ciphertext, 'base64'),
      );
      assertIsApplicationMessage(ciphertextBytes);
    }

    return {
      ciphertext: payload.ciphertext,
      encryptionMeta: payload.encryptionMeta,
    };
  }
}
