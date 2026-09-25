import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecryptedMessage } from '../mls/storage/messagePlaintextStore';
import type { UploadState } from './backupState';
import {
  BackupUploader,
  DEFAULT_UPLOADER_OPTIONS,
  type UploaderDeps,
  type UploaderOptions,
  type UploadItem,
} from './backupUploader';

const message = (id: string): DecryptedMessage => ({
  messageId: id,
  conversationId: 'c1',
  senderDeviceId: 'd1',
  epoch: 1,
  envelope: { v: 1, type: 'text', body: id },
});

function setup(overrides: Partial<UploaderOptions> = {}, initial: Partial<UploadState> = {}) {
  let persisted: UploadState = { queue: [], backfillAfter: null, ...initial };
  const saves: UploadState[] = [];
  const messages = new Map<string, DecryptedMessage>();
  const uploads: UploadItem[][] = [];
  const deps: UploaderDeps = {
    loadMessage: vi.fn(async (id: string) => messages.get(id)),
    loadState: async () => ({ ...persisted, queue: [...persisted.queue] }),
    saveState: vi.fn(async (state: UploadState) => {
      persisted = { ...state, queue: [...state.queue] };
      saves.push(persisted);
    }),
    listIds: async () => [...messages.keys()],
    seal: vi.fn(async (m: DecryptedMessage) => `sealed:${m.messageId}`),
    upload: vi.fn(async (items: UploadItem[]) => {
      uploads.push(items);
    }),
    onDisabled: vi.fn(),
  };
  const uploader = new BackupUploader(deps, { ...DEFAULT_UPLOADER_OPTIONS, ...overrides });
  const add = (...ids: string[]) => ids.forEach((id) => messages.set(id, message(id)));
  return {
    uploader,
    deps,
    uploads,
    saves,
    messages,
    add,
    persisted: () => persisted,
    queue: () => persisted.queue,
  };
}

const httpError = (status: number, extra: object = {}) =>
  Object.assign(new Error('x'), { status, ...extra });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('BackupUploader', () => {
  it('uploads a queued message after the debounce and clears the queue', async () => {
    const { uploader, uploads, add, queue } = setup();
    add('m1');

    await uploader.enqueue('m1');
    expect(uploads).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(queue()).toEqual(['m1']);
    await vi.advanceTimersByTimeAsync(700);

    expect(uploads).toEqual([[{ conversationId: 'c1', messageId: 'm1', ciphertext: 'sealed:m1' }]]);
    expect(queue()).toEqual([]);
  });

  it('coalesces a burst into one batch and ignores duplicate ids', async () => {
    const { uploader, uploads, add } = setup();
    add('m1', 'm2', 'm3');

    await uploader.enqueue('m1');
    await uploader.enqueue('m2');
    await uploader.enqueue('m2');
    await uploader.enqueue('m3');
    await vi.advanceTimersByTimeAsync(1000);

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.map((i) => i.messageId)).toEqual(['m1', 'm2', 'm3']);
  });

  it('splits into batches by item count', async () => {
    const { uploader, uploads, add } = setup({ maxBatchItems: 2 });
    add('m1', 'm2', 'm3', 'm4', 'm5');

    await uploader.enqueueMany(['m1', 'm2', 'm3', 'm4', 'm5']);
    await vi.advanceTimersByTimeAsync(1000);

    expect(uploads.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it('splits into batches by payload size', async () => {
    const { uploader, uploads, add } = setup({ maxBatchChars: 25 });
    add('m1', 'm2', 'm3');

    await uploader.enqueueMany(['m1', 'm2', 'm3']);
    await vi.advanceTimersByTimeAsync(1000);

    expect(uploads.map((b) => b.length)).toEqual([2, 1]);
  });

  it('skips for good ids with no local message or an oversized blob, and counts them', async () => {
    const { uploader, uploads, add, queue } = setup({ maxBlobChars: 5 });
    add('m1');

    await uploader.enqueueMany(['gone', 'm1']);
    await vi.advanceTimersByTimeAsync(1000);

    expect(uploads).toEqual([]);
    expect(queue()).toEqual([]);
    expect(uploader.stats).toEqual({ pending: 0, skipped: 2, rescanning: false });
  });

  it('keeps the queue and retries with growing backoff after a failure', async () => {
    const { uploader, deps, uploads, add, queue } = setup();
    add('m1');
    vi.mocked(deps.upload)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(httpError(503));

    await uploader.enqueue('m1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue()).toEqual(['m1']);

    await vi.advanceTimersByTimeAsync(1999);
    expect(deps.upload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.upload).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3999);
    expect(deps.upload).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(uploads).toHaveLength(1);
    expect(queue()).toEqual([]);
  });

  it('honours Retry-After when it is longer than the backoff', async () => {
    const { uploader, deps, add } = setup();
    add('m1');
    vi.mocked(deps.upload).mockRejectedValueOnce(httpError(429, { retryAfterSeconds: 30 }));

    await uploader.enqueue('m1');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(deps.upload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.upload).toHaveBeenCalledTimes(2);
  });

  it('waits the maximum delay when the quota is full', async () => {
    const { uploader, deps, add } = setup();
    add('m1');
    vi.mocked(deps.upload).mockRejectedValueOnce(httpError(413));

    await uploader.enqueue('m1');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(DEFAULT_UPLOADER_OPTIONS.maxDelayMs - 1);
    expect(deps.upload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.upload).toHaveBeenCalledTimes(2);
  });

  it('isolates a refused item: the rest of its batch still uploads', async () => {
    const { uploader, deps, uploads, add, queue } = setup();
    add('m1', 'bad', 'm3');
    vi.mocked(deps.upload).mockImplementation(async (items) => {
      if (items.some((i) => i.messageId === 'bad')) throw httpError(403);
      uploads.push(items);
    });

    await uploader.enqueueMany(['m1', 'bad', 'm3']);
    await vi.advanceTimersByTimeAsync(1000);

    expect(uploads.flat().map((i) => i.messageId)).toEqual(['m1', 'm3']);
    expect(queue()).toEqual([]);
    expect(uploader.stats.skipped).toBe(1);
  });

  it('on a transient failure mid-way through the one-by-one path, keeps only what is not done', async () => {
    const { uploader, deps, uploads, add, queue } = setup();
    add('m1', 'bad', 'm3');
    let m3Failures = 1;
    vi.mocked(deps.upload).mockImplementation(async (items) => {
      if (items.some((i) => i.messageId === 'bad')) throw httpError(403);
      if (items[0]!.messageId === 'm3' && m3Failures-- > 0) throw httpError(503);
      uploads.push(items);
    });

    await uploader.enqueueMany(['m1', 'bad', 'm3']);
    await vi.advanceTimersByTimeAsync(1000);

    expect(queue()).toEqual(['m3']);
    expect(uploads.flat().map((i) => i.messageId)).toEqual(['m1']);

    await vi.advanceTimersByTimeAsync(2000);
    expect(uploads.flat().map((i) => i.messageId)).toEqual(['m1', 'm3']);
    expect(queue()).toEqual([]);
  });

  it('retries a message whose local read or sealing failed instead of dropping it', async () => {
    const { uploader, deps, uploads, add, queue } = setup();
    add('m1');
    vi.mocked(deps.loadMessage).mockRejectedValueOnce(new Error('idb busy'));
    vi.mocked(deps.seal).mockRejectedValueOnce(new Error('crypto hiccup'));

    await uploader.enqueue('m1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(uploads).toEqual([]);
    expect(queue()).toEqual(['m1']);

    await vi.advanceTimersByTimeAsync(2000);
    expect(queue()).toEqual(['m1']);
    await vi.advanceTimersByTimeAsync(4000);

    expect(uploads.flat().map((i) => i.messageId)).toEqual(['m1']);
    expect(queue()).toEqual([]);
    expect(uploader.stats.skipped).toBe(0);
  });

  it('gives up on one message that keeps failing locally so the rest can go', async () => {
    const { uploader, deps, uploads, add, queue } = setup({ maxItemFailures: 3 });
    add('bad', 'm2');
    vi.mocked(deps.seal).mockImplementation(async (m) => {
      if (m.messageId === 'bad') throw new Error('corrupt');
      return `sealed:${m.messageId}`;
    });

    await uploader.enqueueMany(['bad', 'm2']);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(uploads.flat().map((i) => i.messageId)).toEqual(['m2']);
    expect(queue()).toEqual([]);
    expect(uploader.stats.skipped).toBe(1);
  });

  it('halts, keeps its queue and reports it when backup is off on the server', async () => {
    const { uploader, deps, add } = setup();
    add('m1');
    vi.mocked(deps.upload).mockRejectedValue(httpError(409));

    await uploader.enqueue('m1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(deps.onDisabled).toHaveBeenCalledTimes(1);
    expect(uploader.stats.pending).toBe(1);
  });

  it('resumes a queue persisted by an earlier page load', async () => {
    const { uploader, uploads, add } = setup({}, { queue: ['m1', 'm2'] });
    add('m1', 'm2');

    await uploader.resume();
    await vi.advanceTimersByTimeAsync(0);

    expect(uploads[0]!.map((i) => i.messageId)).toEqual(['m1', 'm2']);
  });

  it('does nothing after stop', async () => {
    const { uploader, deps, add } = setup();
    add('m1');
    await uploader.enqueue('m1');

    await uploader.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await uploader.enqueue('m2');

    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.saveState).not.toHaveBeenCalled();
  });

  it('never throws to the caller when storage fails', async () => {
    const { uploader, deps, add } = setup();
    add('m1');
    vi.mocked(deps.saveState).mockRejectedValue(new Error('disk'));

    await expect(uploader.enqueue('m1')).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it('debounces persistence: a burst of enqueues is one write', async () => {
    const { uploader, deps, add } = setup();
    add('a', 'b', 'c');

    await uploader.enqueue('a');
    await uploader.enqueue('b');
    await uploader.enqueue('c');
    await vi.advanceTimersByTimeAsync(300);

    expect(deps.saveState).toHaveBeenCalledTimes(1);
  });
});

describe('BackupUploader rescan', () => {
  it('walks every local message in chunks and finishes with no rescan pending', async () => {
    const { uploader, uploads, add, persisted } = setup({ backfillChunk: 2 });
    add('m3', 'm1', 'm5', 'm2', 'm4');

    await uploader.startRescan();
    await vi.advanceTimersByTimeAsync(1000);

    expect(uploads.flat().map((i) => i.messageId)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(persisted()).toEqual({ queue: [], backfillAfter: null });
  });

  it('continues an interrupted rescan from its saved position', async () => {
    const { uploader, uploads, add } = setup({ backfillChunk: 2 }, { backfillAfter: 'm2' });
    add('m1', 'm2', 'm3', 'm4');

    await uploader.resume();
    await vi.advanceTimersByTimeAsync(0);

    expect(uploads.flat().map((i) => i.messageId)).toEqual(['m3', 'm4']);
  });

  it('a full queue never loses ids: overflow triggers a rescan that picks them up', async () => {
    const { uploader, uploads, add, persisted } = setup({ maxQueue: 2 });
    add('a', 'b', 'c');

    await uploader.enqueueMany(['a', 'b', 'c']);
    expect(uploader.stats.rescanning).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(new Set(uploads.flat().map((i) => i.messageId))).toEqual(new Set(['a', 'b', 'c']));
    expect(persisted()).toEqual({ queue: [], backfillAfter: null });
  });
});

describe('BackupUploader stop', () => {
  /** An upload that hangs until released, so a drain can be caught in flight. */
  function hangingUpload(deps: UploaderDeps) {
    let release: () => void = () => undefined;
    vi.mocked(deps.upload).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    return () => release();
  }

  it('waits for an in-flight drain and writes nothing once it has resolved', async () => {
    const { uploader, deps, add, saves } = setup();
    add('m1', 'm2');
    const release = hangingUpload(deps);
    await uploader.enqueueMany(['m1', 'm2']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.upload).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = uploader.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    release();
    await stopping;
    const writesAtStop = saves.length;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(saves).toHaveLength(writesAtStop);
  });

  it('a disable racing an in-flight drain cannot rewrite the queue after the clear', async () => {
    const { uploader, deps, add, persisted } = setup();
    add('m1', 'm2');
    const release = hangingUpload(deps);
    await uploader.enqueueMany(['m1', 'm2']);
    await vi.advanceTimersByTimeAsync(1000);

    // What disableBackup does: stop, then clear the stored state.
    const stopping = uploader.stop();
    release();
    await stopping;
    const cleared = { queue: [] as string[], backfillAfter: null };
    await deps.saveState(cleared);
    vi.mocked(deps.saveState).mockClear();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.saveState).not.toHaveBeenCalled();
    expect(persisted()).toEqual(cleared);
  });

  it('persist: true saves the latest queue for a restart under the same user', async () => {
    const { uploader, add, persisted } = setup();
    add('m1');
    await uploader.enqueue('m1');

    await uploader.stop({ persist: true });

    expect(persisted().queue).toEqual(['m1']);
  });

  it('an old uploader stopped for a restart cannot overwrite the new one afterwards', async () => {
    const { uploader, deps, add, persisted } = setup();
    add('m1');
    const release = hangingUpload(deps);
    await uploader.enqueue('m1');
    await vi.advanceTimersByTimeAsync(1000);

    const stopping = uploader.stop({ persist: true });
    release();
    await stopping;
    // The restarted uploader owns the record now.
    await deps.saveState({ queue: ['fresh'], backfillAfter: null });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(persisted().queue).toEqual(['fresh']);
  });
});
