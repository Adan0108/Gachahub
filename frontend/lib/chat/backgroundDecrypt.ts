import { claimDecrypt } from "../mls/messaging/decryptClaims";
import { wasSentByDevice } from "../mls/messaging/messageOrigin";
import { base64ToBytes } from "../mls/storage/base64";
import type { ConversationId } from "../mls/contract/types";
import type { SyncEngine } from "../mls/sync/syncEngine";
import type { EncryptedIndexedDbMessagePlaintextStore } from "../mls/storage/messagePlaintextStore";

export interface PendingMessageRow {
  id: string;
  senderId: string;
  ciphertext: string;
  status?: string;
  encryptionMeta?: unknown;
}

interface DecryptPendingParams {
  engine: Pick<SyncEngine, "isAtCurrentEpoch" | "syncCommits" | "processIncoming">;
  store: Pick<EncryptedIndexedDbMessagePlaintextStore, "get" | "save">;
  conversationId: ConversationId;
  /** Oldest first, as the server returns them. */
  messages: PendingMessageRow[];
  ownDeviceId: string | undefined;
  currentUserId: string;
}

/**
 * Decrypts and caches the messages this device has not read yet, oldest first. Skipped message keys
 * are only kept for the last few messages, so decrypting just the newest could lose the ones before it.
 *
 * Quiet by design: whatever fails is left for the open chat, which knows how to recover a group.
 */
export async function decryptPendingMessages(params: DecryptPendingParams): Promise<void> {
  const { engine, store, conversationId, messages, ownDeviceId, currentUserId } = params;
  const claimed: Array<{ message: PendingMessageRow; release: () => void }> = [];

  try {
    for (const message of messages) {
      if (message.status === "DELETED") continue;
      if (
        message.senderId === currentUserId &&
        ownDeviceId !== undefined &&
        wasSentByDevice(message.encryptionMeta, ownDeviceId)
      ) {
        continue;
      }

      // Claimed before the cache is read, so a decrypt that finishes in between is seen as cached.
      const release = claimDecrypt(message.id);
      if (!release) continue;
      claimed.push({ message, release });

      // A cheap local read; the claim above must come first.
      if (await store.get(message.id)) {
        release();
        claimed.pop();
      }
    }
    if (claimed.length === 0) return;

    const wire = new Map(
      claimed.map(({ message }) => [message.id, base64ToBytes(message.ciphertext)]),
    );
    const current = await Promise.all(
      claimed.map(({ message }) => engine.isAtCurrentEpoch(conversationId, wire.get(message.id)!)),
    );
    if (current.some((isCurrent) => !isCurrent)) await engine.syncCommits(conversationId);

    for (const { message, release } of claimed) {
      try {
        // Each message must be applied in order.
        // Kept before the ratchet is saved: the key cannot be used again.
        await engine.processIncoming(conversationId, wire.get(message.id)!, (decrypted) =>
          store.save({
            messageId: message.id,
            conversationId,
            senderDeviceId: decrypted.senderDeviceId,
            epoch: decrypted.epoch,
            envelope: decrypted.envelope,
          }),
        );
      } catch (error) {
        console.warn(`Could not decrypt message ${message.id} in the background`, error);
      } finally {
        release();
      }
    }
  } finally {
    // Anything not reached above (a failed sync, say) goes back to whoever opens the chat.
    for (const { release } of claimed) release();
  }
}
