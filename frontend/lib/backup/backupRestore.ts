import { base64ToBytes } from '../mls/storage/base64';
import type { MessagePlaintextStore } from '../mls/storage/messagePlaintextStore';
import { decryptBlob } from './backupCrypto';

export interface BackupPage {
  items: { conversationId: string; messageId: string; ciphertext: string }[];
  nextCursor: string | null;
}

export interface RestoreProgress {
  processed: number;
  restored: number;
  skipped: number;
  failed: number;
}

export interface RestoreResult extends RestoreProgress {
  cancelled: boolean;
}

export interface RestoreOptions {
  key: CryptoKey;
  userId: string;
  fetchPage(after?: string): Promise<BackupPage>;
  store: Pick<MessagePlaintextStore, 'get' | 'saveWithoutNotify'>;
  onProgress?(progress: RestoreProgress): void;
  signal?: AbortSignal;
}

/**
 * Pulls the backup down page by page into the local plaintext store. Messages already on this
 * device are left alone; one unreadable blob is counted, not fatal. A failed page fetch throws,
 * and running again picks up where it stopped because finished messages are skipped.
 */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const { key, userId, fetchPage, store, onProgress, signal } = options;
  const progress: RestoreProgress = { processed: 0, restored: 0, skipped: 0, failed: 0 };
  let cursor: string | undefined;

  do {
    if (signal?.aborted) return { ...progress, cancelled: true };
    const page = await fetchPage(cursor);
    for (const item of page.items) {
      if (signal?.aborted) return { ...progress, cancelled: true };
      const outcome = await restoreOne(item);
      progress[outcome] += 1;
      progress.processed += 1;
    }
    onProgress?.({ ...progress });
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return { ...progress, cancelled: false };

  async function restoreOne(item: BackupPage['items'][number]) {
    try {
      if (await store.get(item.messageId)) return 'skipped';
      const { conversationId, messageId } = item;
      const payload = await decryptBlob(
        key,
        { userId, conversationId, messageId },
        base64ToBytes(item.ciphertext),
      );
      await store.saveWithoutNotify({ messageId, conversationId, ...payload });
      return 'restored';
    } catch {
      return 'failed';
    }
  }
}
