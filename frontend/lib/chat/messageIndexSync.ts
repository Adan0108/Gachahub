import type { MessagePlaintextStore } from '../mls/storage/messagePlaintextStore';
import type { SearchableMessages } from './searchableMessages';

export type IndexStatus = 'idle' | 'indexing' | 'ready';

export interface SyncReport {
  status: IndexStatus;
  indexed: number;
  total: number;
  /** True for a start or an end; false for a progress tick that may be held back. */
  milestone: boolean;
}

const SYNC_BATCH_SIZE = 50;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Reads every stored message into the searchable messages, a batch at a time so the page stays responsive. */
export class MessageIndexSync {
  // Bumped by cancel(), so a run that was already going stops instead of refilling a cleared index.
  private generation = 0;
  private running: Promise<void> | null = null;
  // Removed while a run was reading the store, so its stale read cannot bring the message back.
  private readonly removedDuringRun = new Set<string>();

  constructor(
    private readonly messages: SearchableMessages,
    private readonly report: (report: SyncReport) => void,
  ) {}

  /** Indexes every stored message not indexed yet; shares a run that is already going. */
  run(store: MessagePlaintextStore, batchSize = SYNC_BATCH_SIZE): Promise<void> {
    // Resolves when the run already going finishes; messages another tab wrote since it listed the store are not in it.
    if (this.running) return this.running;
    const run = this.walk(store, batchSize, this.generation).finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  noteAdded(messageId: string): void {
    this.removedDuringRun.delete(messageId);
  }

  noteRemoved(messageId: string): void {
    if (this.running) this.removedDuringRun.add(messageId);
  }

  /** Stops the run in progress, if any. */
  cancel(): void {
    this.generation += 1;
    this.running = null;
    this.removedDuringRun.clear();
  }

  private async walk(store: MessagePlaintextStore, batchSize: number, generation: number): Promise<void> {
    this.removedDuringRun.clear();
    let indexed = 0;
    let total = 0;
    const report = (status: IndexStatus, milestone: boolean) => this.report({ status, indexed, total, milestone });
    report('indexing', true);
    try {
      const missing = (await store.listIds()).filter((id) => !this.messages.has(id));
      if (generation !== this.generation) return;
      total = missing.length;
      report('indexing', true);
      for (let from = 0; from < missing.length; from += batchSize) {
        if (generation !== this.generation) return;
        const batch = missing.slice(from, from + batchSize);
        await Promise.all(batch.map((id) => this.load(store, id, generation)));
        if (generation !== this.generation) return;
        indexed += batch.length;
        report('indexing', false);
        await yieldToEventLoop();
      }
      if (generation === this.generation) report('ready', true);
    } catch (error) {
      console.warn('Could not index messages for search', error);
      if (generation === this.generation) report('idle', true);
    }
  }

  private async load(store: MessagePlaintextStore, id: string, generation: number): Promise<void> {
    try {
      const saved = await store.get(id);
      if (saved && generation === this.generation && !this.removedDuringRun.has(id)) this.messages.put(saved);
    } catch (error) {
      console.warn(`Could not read message ${id} for search`, error);
    }
  }
}
