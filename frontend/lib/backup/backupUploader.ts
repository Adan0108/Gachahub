import type { DecryptedMessage } from '../mls/storage/messagePlaintextStore';
import { EMPTY_UPLOAD_STATE, type UploadState } from './backupState';

export interface UploadItem {
  conversationId: string;
  messageId: string;
  ciphertext: string;
}

export interface UploaderDeps {
  loadMessage(messageId: string): Promise<DecryptedMessage | undefined>;
  loadState(): Promise<UploadState>;
  saveState(state: UploadState): Promise<void>;
  /** Every message id in the local cache; feeds the rescan. */
  listIds(): Promise<string[]>;
  /** Encrypts under the backup key; returns base64. */
  seal(message: DecryptedMessage): Promise<string>;
  upload(items: UploadItem[]): Promise<void>;
  /** The server says backup is off (409); the uploader has already halted. */
  onDisabled?(): void;
}

export interface UploaderOptions {
  maxBatchItems: number;
  maxBatchChars: number;
  maxBlobChars: number;
  maxQueue: number;
  /** How many ids one rescan step moves into the queue. */
  backfillChunk: number;
  /** Consecutive local failures (storage, sealing) after which one message is given up on. */
  maxItemFailures: number;
  baseDelayMs: number;
  maxDelayMs: number;
  debounceMs: number;
  persistDebounceMs: number;
}

export const DEFAULT_UPLOADER_OPTIONS: UploaderOptions = {
  maxBatchItems: 100,
  // Keeps a request under the server's 2 MB JSON body limit.
  maxBatchChars: 1_000_000,
  // The server's 64 KB blob cap, as base64.
  maxBlobChars: Math.floor((64 * 1024 * 4) / 3),
  maxQueue: 20_000,
  backfillChunk: 1_000,
  maxItemFailures: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 5 * 60_000,
  debounceMs: 1_000,
  persistDebounceMs: 300,
};

export interface UploaderStats {
  pending: number;
  /** Messages given up on for good: gone locally, too big, refused by the server, or unreadable here. */
  skipped: number;
  rescanning: boolean;
}

interface Entry {
  id: string;
  item?: UploadItem;
}

const statusOf = (error: unknown) => (error as { status?: number } | null)?.status;
// The server refused this content itself, so retrying the same item can never work.
const isPermanent = (status: number | undefined) =>
  status === 400 || status === 403 || status === 404;

/** Durable queue of ids still to back up, plus a durable rescan of the local cache so nothing is left out; best effort, retried with backoff. */
export class BackupUploader {
  private queue: string[] = [];
  private known = new Set<string>();
  private backfillAfter: string | null = null;
  private loaded: Promise<void> | undefined;
  private snapshot: string[] | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private writing: Promise<void> = Promise.resolve();
  private stopped = false;
  private discarded = false;
  private attempts = 0;
  private skipped = 0;
  private readonly itemFailures = new Map<string, number>();

  constructor(
    private readonly deps: UploaderDeps,
    private readonly options: UploaderOptions = DEFAULT_UPLOADER_OPTIONS,
  ) {}

  get stats(): UploaderStats {
    return {
      pending: this.queue.length,
      skipped: this.skipped,
      rescanning: this.backfillAfter !== null,
    };
  }

  enqueue(messageId: string): Promise<void> {
    return this.enqueueMany([messageId]);
  }

  async enqueueMany(messageIds: string[]): Promise<void> {
    await this.load();
    if (this.stopped) return;
    for (const id of messageIds) {
      if (this.known.has(id)) continue;
      if (this.queue.length >= this.options.maxQueue) {
        // No room: a rescan from the start picks up everything left out.
        this.backfillAfter = '';
        this.snapshot = undefined;
        break;
      }
      this.known.add(id);
      this.queue.push(id);
    }
    this.markDirty();
    this.schedule(this.options.debounceMs);
  }

  /** Walks every message in the local cache into the queue in chunks; the server skips what it already has. */
  async startRescan(): Promise<void> {
    await this.load();
    if (this.stopped) return;
    this.backfillAfter = '';
    this.snapshot = undefined;
    this.markDirty();
    this.schedule(0);
  }

  /** Resumes whatever an earlier page load left behind. */
  async resume(): Promise<void> {
    await this.load();
    this.schedule(0);
  }

  /** Waits for the running flush, then stops for good; nothing is written after it resolves unless `persist` asks for a last save. */
  async stop({ persist = false }: { persist?: boolean } = {}): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    await this.running;
    if (persist && this.loaded) await this.write();
    this.discarded = true;
    await this.writing;
  }

  /** Runs until nothing is left or a failure schedules a retry; concurrent calls share one run. */
  flush(): Promise<void> {
    this.running ??= this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private load(): Promise<void> {
    this.loaded ??= this.deps
      .loadState()
      .catch(() => ({ ...EMPTY_UPLOAD_STATE }))
      .then((state) => {
        this.queue = [...state.queue];
        this.known = new Set(this.queue);
        this.backfillAfter = state.backfillAfter;
      });
    return this.loaded;
  }

  private markDirty(): void {
    if (this.stopped || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.write();
    }, this.options.persistDebounceMs);
  }

  /** Queues a save of the current state; skipped once stop() has discarded this uploader. */
  private write(): Promise<void> {
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    const state: UploadState = { queue: [...this.queue], backfillAfter: this.backfillAfter };
    this.writing = this.writing.then(() =>
      this.discarded ? undefined : this.deps.saveState(state).catch(() => undefined),
    );
    return this.writing;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delayMs);
  }

  private async drain(): Promise<void> {
    await this.load();
    while (!this.stopped) {
      if (this.queue.length === 0) {
        if (this.backfillAfter === null || !(await this.refillFromRescan())) break;
        continue;
      }
      const { entries, failure } = await this.nextBatch();
      if (entries.length === 0) {
        this.scheduleRetry(failure);
        break;
      }
      const items = entries.flatMap((entry) => (entry.item ? [entry.item] : []));
      const done = items.length > 0 ? await this.send(items) : 0;
      this.consume(entries, done);
      this.markDirty();
      if (done < items.length) break;
      this.attempts = 0;
      if (failure) {
        this.scheduleRetry(failure);
        break;
      }
    }
    if (!this.stopped) await this.write();
  }

  /** Moves the next chunk of local ids into the queue; false when the rescan is finished or cannot go on. */
  private async refillFromRescan(): Promise<boolean> {
    try {
      this.snapshot ??= (await this.deps.listIds()).sort();
    } catch (error) {
      this.scheduleRetry(error);
      return false;
    }
    if (this.stopped) return false;
    const after = this.backfillAfter ?? '';
    const start = this.snapshot.findIndex((id) => id > after);
    const chunk = start < 0 ? [] : this.snapshot.slice(start, start + this.options.backfillChunk);
    if (chunk.length === 0) {
      this.backfillAfter = null;
      this.snapshot = undefined;
      this.markDirty();
      return false;
    }
    for (const id of chunk) {
      if (!this.known.has(id)) {
        this.known.add(id);
        this.queue.push(id);
      }
    }
    this.backfillAfter = chunk[chunk.length - 1]!;
    this.markDirty();
    return true;
  }

  /** Takes ids from the front until a batch limit is hit; ids with nothing to send are consumed too. */
  private async nextBatch(): Promise<{ entries: Entry[]; failure?: unknown }> {
    const entries: Entry[] = [];
    let chars = 0;
    let items = 0;
    for (const id of this.queue) {
      if (items >= this.options.maxBatchItems) break;
      let item: UploadItem | undefined;
      try {
        item = await this.toItem(id);
      } catch (failure) {
        if (this.giveUpOn(id)) {
          entries.push({ id });
          continue;
        }
        return { entries, failure };
      }
      if (item && items > 0 && chars + item.ciphertext.length > this.options.maxBatchChars) break;
      entries.push({ id, item });
      if (item) {
        items += 1;
        chars += item.ciphertext.length;
      }
    }
    return { entries };
  }

  /** Undefined means skip for good; a throw is a local hiccup worth retrying. */
  private async toItem(messageId: string): Promise<UploadItem | undefined> {
    const message = await this.deps.loadMessage(messageId);
    if (!message) return undefined;
    const ciphertext = await this.deps.seal(message);
    if (ciphertext.length > this.options.maxBlobChars) return undefined;
    this.itemFailures.delete(messageId);
    return { conversationId: message.conversationId, messageId, ciphertext };
  }

  private giveUpOn(id: string): boolean {
    const failures = (this.itemFailures.get(id) ?? 0) + 1;
    if (failures < this.options.maxItemFailures) {
      this.itemFailures.set(id, failures);
      return false;
    }
    this.itemFailures.delete(id);
    return true;
  }

  /** Drops the finished prefix of the batch from the queue: everything up to the first item not yet done. */
  private consume(entries: Entry[], doneItems: number): void {
    let seen = 0;
    let count = 0;
    for (const entry of entries) {
      if (entry.item && seen++ === doneItems) break;
      count += 1;
    }
    for (const entry of entries.slice(0, count)) {
      this.known.delete(entry.id);
      if (!entry.item) this.skipped += 1;
    }
    // In place: enqueue() may be appending to this same array.
    this.queue.splice(0, count);
  }

  /** How many leading items are finished (uploaded, or refused for good); the rest wait for a retry. */
  private async send(items: UploadItem[]): Promise<number> {
    try {
      await this.deps.upload(items);
      return items.length;
    } catch (error) {
      const status = statusOf(error);
      if (isPermanent(status)) {
        if (items.length === 1) {
          this.skipped += 1;
          return 1;
        }
        // One bad item must not block the rest of its batch.
        let done = 0;
        for (const item of items) {
          const finished = await this.send([item]);
          done += finished;
          if (finished === 0) break;
        }
        return done;
      }
      if (status === 409) {
        this.halt();
        return 0;
      }
      this.scheduleRetry(error);
      return 0;
    }
  }

  /** Backup is off on the server: nothing to retry, so stop scheduling and tell the owner. */
  private halt(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    this.deps.onDisabled?.();
  }

  private scheduleRetry(error: unknown): void {
    const retryAfterMs = ((error as { retryAfterSeconds?: number } | null)?.retryAfterSeconds ?? 0) * 1000;
    // 413 means the storage quota is full, so hammering the server only wastes requests.
    const base = statusOf(error) === 413 ? this.options.maxDelayMs : this.options.baseDelayMs;
    const backoff = Math.min(this.options.maxDelayMs, base * 2 ** this.attempts);
    this.attempts += 1;
    this.schedule(Math.max(backoff, retryAfterMs));
  }
}
