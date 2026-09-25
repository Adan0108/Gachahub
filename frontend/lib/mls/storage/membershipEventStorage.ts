import type { ConversationId } from '../contract/types';
import type { MembershipEvent } from '../sync/membershipEvents';
import {
  encryptAndStore,
  listRecordIds,
  loadAndDecryptOrMissing,
  openMlsDatabase,
} from './mlsEncryptedStore';

export interface MembershipEventStorage {
  /** Oldest first. */
  load(conversationId: ConversationId): Promise<MembershipEvent[]>;
  /** Stores each event under its own id (a repeat is a no-op) and returns the ones that were new. */
  add(events: MembershipEvent[]): Promise<MembershipEvent[]>;
}

const byTime = (a: MembershipEvent, b: MembershipEvent) => a.at - b.at || a.epoch - b.epoch;

// One record per event so two tabs writing the same event collapse instead of racing a list.
const SEPARATOR = '\u001f';
const recordId = (event: MembershipEvent) => `${event.conversationId}${SEPARATOR}${event.id}`;
const conversationPrefix = (conversationId: ConversationId) => `${conversationId}${SEPARATOR}`;

export class InMemoryMembershipEventStorage implements MembershipEventStorage {
  private readonly values = new Map<string, MembershipEvent>();

  async load(conversationId: ConversationId): Promise<MembershipEvent[]> {
    return [...this.values.entries()]
      .filter(([id]) => id.startsWith(conversationPrefix(conversationId)))
      .map(([, event]) => event)
      .sort(byTime);
  }

  async add(events: MembershipEvent[]): Promise<MembershipEvent[]> {
    const fresh = events.filter((event) => !this.values.has(recordId(event)));
    for (const event of fresh) this.values.set(recordId(event), event);
    return fresh;
  }
}

const MEMBERSHIP_EVENT_STORE = 'membershipEvents';

/** Encrypted-at-rest, one record per event - see mlsEncryptedStore.ts for the shared plumbing. */
export class EncryptedIndexedDbMembershipEventStorage implements MembershipEventStorage {
  async load(conversationId: ConversationId): Promise<MembershipEvent[]> {
    const db = await openMlsDatabase();
    const prefix = conversationPrefix(conversationId);
    const ids = (await listRecordIds(db, MEMBERSHIP_EVENT_STORE)).filter((id) =>
      id.startsWith(prefix),
    );
    const events = await Promise.all(
      ids.map((id) => loadAndDecryptOrMissing<MembershipEvent>(db, MEMBERSHIP_EVENT_STORE, id)),
    );
    return events.filter((event): event is MembershipEvent => event !== undefined).sort(byTime);
  }

  async add(events: MembershipEvent[]): Promise<MembershipEvent[]> {
    const db = await openMlsDatabase();
    const existing = new Set(await listRecordIds(db, MEMBERSHIP_EVENT_STORE));
    const fresh = events.filter((event) => !existing.has(recordId(event)));
    await Promise.all(
      fresh.map((event) => encryptAndStore(db, MEMBERSHIP_EVENT_STORE, recordId(event), event)),
    );
    return fresh;
  }
}
