import { EncryptedMessagePayloadDto } from '../dto/encrypted-message-payload.dto';

export const MESSAGE_ENCRYPTION_PORT = Symbol('MESSAGE_ENCRYPTION_PORT');

/**
 * Encrypted payload prepared for database storage.
 *
 * The backend treats this as opaque data. Decryption belongs to the client in
 * the current true client-side encryption design.
 */
export interface PreparedEncryptedMessage {
  ciphertext: string;
  encryptionMeta?: Record<string, unknown>;
}

/**
 * Port for validating/preparing encrypted message payloads.
 *
 * current implementation passes ciphertext through unchanged. Future
 * protocol validation can be added behind this interface without touching the
 * chat business rules.
 */
export interface MessageEncryptionPort {
  preparePayload(
    payload: EncryptedMessagePayloadDto,
  ): Promise<PreparedEncryptedMessage>;
}
