import { EncryptedMessagePayloadDto } from '../dto/encrypted-message-payload.dto';

export const MESSAGE_ENCRYPTION_PORT = Symbol('MESSAGE_ENCRYPTION_PORT');

export interface PreparedEncryptedMessage {
  ciphertext: string;
  encryptionMeta?: Record<string, unknown>;
}

export interface MessageEncryptionPort {
  preparePayload(
    payload: EncryptedMessagePayloadDto,
  ): Promise<PreparedEncryptedMessage>;
}
