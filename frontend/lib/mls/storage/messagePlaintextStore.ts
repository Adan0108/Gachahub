import type { ConversationId, DeviceId, Epoch, PlaintextEnvelope } from '../contract/types';
import {
  openMlsDatabase,
  deleteRecord,
  encryptAndStore,
  listRecordIds,
  loadAndDecryptOrMissing,
} from './mlsEncryptedStore';

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
  /** Stores without firing onMessageSaved, for messages that came from somewhere else (a restore). */
  saveWithoutNotify(message: DecryptedMessage): Promise<void>;
  listIds(): Promise<string[]>;
  /** Drops a message's cached plaintext - called once it's seen as unsent, so a quote of it can't keep showing the text. */
  remove(messageId: string): Promise<void>;
}

type MessageSavedListener = (message: DecryptedMessage) => void;
const savedListeners = new Set<MessageSavedListener>();

/** Runs after each freshly decrypted or sent message is cached; returns an unsubscribe. */
export function onMessageSaved(listener: MessageSavedListener): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

type MessageRemovedListener = (messageId: string) => void;
const removedListeners = new Set<MessageRemovedListener>();

/** Runs after a message's cached plaintext is dropped; returns an unsubscribe. */
export function onMessageRemoved(listener: MessageRemovedListener): () => void {
  removedListeners.add(listener);
  return () => removedListeners.delete(listener);
}

/** Calls every listener; one that throws never stops the rest. */
function notify<T>(listeners: Set<(value: T) => void>, value: T, what: string): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.warn(`A ${what} listener failed`, error);
    }
  }
}

export class InMemoryMessagePlaintextStore implements MessagePlaintextStore {
  private readonly values = new Map<string, DecryptedMessage>();

  async get(messageId: string): Promise<DecryptedMessage | undefined> {
    return this.values.get(messageId);
  }

  async save(message: DecryptedMessage): Promise<void> {
    await this.saveWithoutNotify(message);
    notify(savedListeners, message, 'message-saved');
  }

  async saveWithoutNotify(message: DecryptedMessage): Promise<void> {
    this.values.set(message.messageId, message);
  }

  async listIds(): Promise<string[]> {
    return [...this.values.keys()];
  }

  async remove(messageId: string): Promise<void> {
    this.values.delete(messageId);
    notify(removedListeners, messageId, 'message-removed');
  }
}

const MESSAGE_PLAINTEXT_STORE = 'decryptedMessages';
const OUTGOING_STORE = 'outgoingMessages';

/** A sent message's plaintext before the server has given it an id. */
export type OutgoingMessage = Omit<DecryptedMessage, 'messageId'>;

/**
 * Keeps a message's plaintext by its clientMessageId from just before it is sent until it is saved
 * under the server's id. The sender can never decrypt its own message, so if the tab dies or the
 * save fails after the server accepted it, this copy is the only way to show the text again.
 */
export class OutgoingMessageStore {
  async keep(clientMessageId: string, message: OutgoingMessage): Promise<void> {
    await encryptAndStore(await openMlsDatabase(), OUTGOING_STORE, clientMessageId, message);
  }

  async get(clientMessageId: string): Promise<OutgoingMessage | undefined> {
    return loadAndDecryptOrMissing<OutgoingMessage>(await openMlsDatabase(), OUTGOING_STORE, clientMessageId);
  }

  async drop(clientMessageId: string): Promise<void> {
    await deleteRecord(await openMlsDatabase(), OUTGOING_STORE, clientMessageId);
  }
}

export class EncryptedIndexedDbMessagePlaintextStore implements MessagePlaintextStore {
  async get(messageId: string): Promise<DecryptedMessage | undefined> {
    const db = await openMlsDatabase();
    return loadAndDecryptOrMissing<DecryptedMessage>(db, MESSAGE_PLAINTEXT_STORE, messageId);
  }

  async save(message: DecryptedMessage): Promise<void> {
    await this.saveWithoutNotify(message);
    notify(savedListeners, message, 'message-saved');
  }

  async saveWithoutNotify(message: DecryptedMessage): Promise<void> {
    const db = await openMlsDatabase();
    await encryptAndStore(db, MESSAGE_PLAINTEXT_STORE, message.messageId, message);
  }

  async listIds(): Promise<string[]> {
    return listRecordIds(await openMlsDatabase(), MESSAGE_PLAINTEXT_STORE);
  }

  async remove(messageId: string): Promise<void> {
    await deleteRecord(await openMlsDatabase(), MESSAGE_PLAINTEXT_STORE, messageId);
    notify(removedListeners, messageId, 'message-removed');
  }
}
