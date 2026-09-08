import { Injectable } from '@nestjs/common';
import { EncryptedMessagePayloadDto } from './dto/encrypted-message-payload.dto';
import {
  MessageEncryptionPort,
  PreparedEncryptedMessage,
} from './ports/message-encryption.port';

/**
 * Preserves true client-side encryption.
 *
 * This service intentionally does not decrypt or transform the payload. It
 * exists so future protocol validation can be added without touching chat
 * business rules.
 */
@Injectable()
export class OpaqueMessageEncryptionService implements MessageEncryptionPort {
  preparePayload(
    payload: EncryptedMessagePayloadDto,
  ): Promise<PreparedEncryptedMessage> {
    return Promise.resolve({
      ciphertext: payload.ciphertext,
      encryptionMeta: payload.encryptionMeta,
    });
  }
}
