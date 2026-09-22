import { api } from '../../api';
import { bytesToBase64 } from '../storage/base64';
import { ensureConversationGroup } from './ensureConversationGroup';
import { senderMeta } from './messageOrigin';
import type { SyncEngine } from '../sync/syncEngine';
import { EncryptedIndexedDbMessagePlaintextStore } from '../storage/messagePlaintextStore';
import type { ConversationId, DeviceId, UserId } from '../contract/types';

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

/**
 * Encrypts `text` for `conversationId`, sends it, and saves the plaintext
 * locally under the server-assigned message id - the sender never decrypts
 * its own message later (that generation's key is already gone by the time
 * encryptMessage returns), so this is the only chance to ever cache it.
 *
 * `clientMessageId` must stay the same across retries of one message: the backend returns the message
 * it already stored for that id, so a retry after a lost response is not delivered twice.
 *
 * Ensures a local MLS group exists first (see ensureConversationGroup) so
 * this doubles as "finish setting up encryption" for a conversation that
 * was just created, or a request that just got accepted - the caller
 * doesn't need a separate step for that.
 */
export async function sendEncryptedChatMessage(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId,
  text: string,
  clientMessageId: string,
) {
  try {
    return await encryptAndSend(
      syncEngine,
      deviceId,
      conversationId,
      recipientUserId,
      text,
      clientMessageId,
    );
  } catch (error) {
    if (!isMembershipChangePending(error)) throw error;

    // A member is being removed, so anything encrypted now would still be
    // readable to them. Finish the removal, then encrypt again under the new
    // epoch - the attempt that was refused is simply discarded, and one retry
    // is all a pending change should ever need.
    await syncEngine.reconcileMembership({ conversationId });
    return encryptAndSend(
      syncEngine,
      deviceId,
      conversationId,
      recipientUserId,
      text,
      clientMessageId,
    );
  }
}

function isMembershipChangePending(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'MEMBERSHIP_CHANGE_PENDING'
  );
}

async function encryptAndSend(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId,
  text: string,
  clientMessageId: string,
) {
  await ensureConversationGroup(syncEngine, conversationId, recipientUserId);

  const envelope = { v: 1 as const, type: 'text' as const, body: text };
  const { wireBytes, epoch } = await syncEngine.encryptMessage(conversationId, envelope);

  const response = await api.sendChatMessage(conversationId, {
    ciphertext: bytesToBase64(wireBytes),
    contentType: 'TEXT',
    clientMessageId,
    encryptionMeta: senderMeta(deviceId),
  });

  await plaintextStore.save({
    messageId: response.message.id,
    conversationId,
    senderDeviceId: deviceId,
    epoch,
    envelope,
  });

  return response;
}
