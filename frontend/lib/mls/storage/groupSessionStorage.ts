import type { ConversationId } from '../contract/types';
import { openMlsDatabase, encryptAndStore, loadAndDecrypt, deleteRecord } from './mlsEncryptedStore';

/**
 * Persists one conversation's GroupSession.serialize() bytes across reloads
 * (client.ts: "ratchet tree, pending proposals, and this device's per-epoch
 * secrets not yet consumed" - threat-model §5). One record per conversation,
 * keyed by conversationId.
 */
export interface GroupSessionStorage {
  load(conversationId: ConversationId): Promise<Uint8Array | undefined>;
  save(conversationId: ConversationId, stateBytes: Uint8Array): Promise<void>;
  delete(conversationId: ConversationId): Promise<void>;
}

export class InMemoryGroupSessionStorage implements GroupSessionStorage {
  private readonly values = new Map<ConversationId, Uint8Array>();

  async load(conversationId: ConversationId): Promise<Uint8Array | undefined> {
    return this.values.get(conversationId);
  }

  async save(conversationId: ConversationId, stateBytes: Uint8Array): Promise<void> {
    this.values.set(conversationId, stateBytes);
  }

  async delete(conversationId: ConversationId): Promise<void> {
    this.values.delete(conversationId);
  }
}

const GROUP_SESSION_STORE = 'groupSessions';

/**
 * Encrypted-at-rest group session storage (threat-model §5) - see
 * mlsEncryptedStore.ts for the shared AES-GCM/IndexedDB plumbing, and
 * deviceIdentityStorage.ts for the sibling store this shares its database
 * and encryption key with.
 */
export class EncryptedIndexedDbGroupSessionStorage implements GroupSessionStorage {
  async load(conversationId: ConversationId): Promise<Uint8Array | undefined> {
    const db = await openMlsDatabase();
    return loadAndDecrypt<Uint8Array>(db, GROUP_SESSION_STORE, conversationId);
  }

  async save(conversationId: ConversationId, stateBytes: Uint8Array): Promise<void> {
    const db = await openMlsDatabase();
    await encryptAndStore(db, GROUP_SESSION_STORE, conversationId, stateBytes);
  }

  async delete(conversationId: ConversationId): Promise<void> {
    const db = await openMlsDatabase();
    await deleteRecord(db, GROUP_SESSION_STORE, conversationId);
  }
}
