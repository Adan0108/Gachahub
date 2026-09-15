import type { ConversationId, DeviceId, Epoch, PlaintextEnvelope } from './types';
import { openMlsDatabase, encryptAndStore, loadAndDecrypt } from './mlsEncryptedStore';

/**
 * A decrypted message, cached locally forever after the one time it's
 * decrypted - MLS deletes each message's key immediately after use, so
 * there is no "decrypt on read" the way a plaintext-column UI might expect
 * (threat-model §5). Losing this record (a different device, or a cleared
 * profile) means that message's content is gone for good on this device.
 */
export interface DecryptedMessage {
  messageId: string;
  conversationId: ConversationId;
  senderDeviceId: DeviceId;
  epoch: Epoch;
  envelope: PlaintextEnvelope;
}

export interface MessagePlaintextStore {
  get(messageId: string): Promise<DecryptedMessage | undefined>;
  save(message: DecryptedMessage): Promise<void>;
}

export class InMemoryMessagePlaintextStore implements MessagePlaintextStore {
  private readonly values = new Map<string, DecryptedMessage>();

  async get(messageId: string): Promise<DecryptedMessage | undefined> {
    return this.values.get(messageId);
  }

  async save(message: DecryptedMessage): Promise<void> {
    this.values.set(message.messageId, message);
  }
}

const MESSAGE_PLAINTEXT_STORE = 'decryptedMessages';

/** Encrypted-at-rest decrypted-message cache (threat-model §5) - see mlsEncryptedStore.ts for the shared AES-GCM/IndexedDB plumbing. */
export class EncryptedIndexedDbMessagePlaintextStore implements MessagePlaintextStore {
  async get(messageId: string): Promise<DecryptedMessage | undefined> {
    const db = await openMlsDatabase();
    return loadAndDecrypt<DecryptedMessage>(db, MESSAGE_PLAINTEXT_STORE, messageId);
  }

  async save(message: DecryptedMessage): Promise<void> {
    const db = await openMlsDatabase();
    await encryptAndStore(db, MESSAGE_PLAINTEXT_STORE, message.messageId, message);
  }
}
