import type { DecryptedMessage, MessagePlaintextStore } from '../mls/storage/messagePlaintextStore';
import { MessageIndexSync, type IndexStatus, type SyncReport } from './messageIndexSync';
import { ObservableSnapshot } from './observableSnapshot';
import { SearchableMessages, type MessageSearcher, type SearchResult } from './searchableMessages';

export type { MessageSearcher, SearchHit, SearchResult } from './searchableMessages';
export { searchableText } from './searchableMessages';
export type { IndexStatus } from './messageIndexSync';

/** Changes (a new object) whenever the index or its status does; for useSyncExternalStore. */
export interface IndexSnapshot {
  status: IndexStatus;
  version: number;
  /** Messages read so far, out of `total` to read, in the current sync. */
  indexed: number;
  total: number;
}

// While a sync runs, listeners hear about progress at most this often, so a big history does not re-render the page per batch.
const PROGRESS_PUBLISH_MS = 400;

/** 0-100 for a sync in progress, or null while the total is not known. */
export function indexProgressPercent({ indexed, total }: Pick<IndexSnapshot, 'indexed' | 'total'>): number | null {
  return total > 0 ? Math.min(100, Math.floor((indexed / total) * 100)) : null;
}

/** What to show while the index is still filling. */
export function indexingLabel(snapshot: Pick<IndexSnapshot, 'indexed' | 'total'>): string {
  const percent = indexProgressPercent(snapshot);
  return `Indexing messages on this device${percent === null ? '' : ` (${percent}%)`}...`;
}

/**
 * Search over messages this device has already decrypted. Held in memory only: the plaintext
 * cache is encrypted at rest, so a persisted index would undo that. Fed by `syncWith` (everything
 * stored so far) and kept current with `add` / `remove`.
 */
export class MessageSearchIndex implements MessageSearcher {
  private readonly messages = new SearchableMessages();
  private readonly state = new ObservableSnapshot<IndexSnapshot>({
    status: 'idle',
    version: 0,
    indexed: 0,
    total: 0,
  });
  private readonly sync = new MessageIndexSync(this.messages, (report) => this.onSyncReport(report));
  private progress = { indexed: 0, total: 0 };
  private lastPublishAt = 0;

  constructor(private readonly progressIntervalMs = PROGRESS_PUBLISH_MS) {}

  get size(): number {
    return this.messages.size;
  }

  subscribe = this.state.subscribe;

  getSnapshot = this.state.getSnapshot;

  add(message: DecryptedMessage): void {
    this.sync.noteAdded(message.messageId);
    this.messages.put(message);
    this.publish();
  }

  remove(messageId: string): void {
    this.sync.noteRemoved(messageId);
    if (this.messages.delete(messageId)) this.publish();
  }

  /** Forgets everything, including any sync in progress. */
  clear(): void {
    this.sync.cancel();
    this.messages.clear();
    this.progress = { indexed: 0, total: 0 };
    this.publish('idle');
  }

  /** Indexes every stored message not indexed yet, a batch at a time so the page stays responsive. */
  syncWith(store: MessagePlaintextStore, batchSize?: number): Promise<void> {
    return this.sync.run(store, batchSize);
  }

  search(query: string, options?: { conversationId?: string }): SearchResult {
    return this.messages.search(query, options);
  }

  private onSyncReport({ status, indexed, total, milestone }: SyncReport): void {
    this.progress = { indexed, total };
    if (milestone || Date.now() - this.lastPublishAt >= this.progressIntervalMs) this.publish(status);
  }

  private publish(status: IndexStatus = this.state.getSnapshot().status): void {
    this.lastPublishAt = Date.now();
    this.state.set({ status, version: this.state.getSnapshot().version + 1, ...this.progress });
  }
}
