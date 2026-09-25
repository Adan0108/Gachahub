import { api } from '../../api';
import { bytesToBase64 } from '../storage/base64';
import { ensureConversationGroup } from './ensureConversationGroup';
import { senderMeta } from './messageOrigin';
import type { SyncEngine } from '../sync/syncEngine';
import { EncryptedIndexedDbMessagePlaintextStore } from '../storage/messagePlaintextStore';
import type { ConversationId, DeviceId, PlaintextEnvelope, UserId } from '../contract/types';

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

/** Encrypts `text` for `conversationId`, sends it, and saves the plaintext locally under the server-assigned message id - the sender never decrypts its own message later (that generation's key is already gone by the time encryptMessage returns), so this is the only chance to ever cache it. `clientMessageId` must stay the same across retries of one message: the backend returns the message it already stored for that id, so a retry after a lost response is not delivered twice */
export function sendEncryptedChatMessage(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  text: string,
  clientMessageId: string,
) {
  return sendEncryptedEnvelope(
    syncEngine,
    deviceId,
    conversationId,
    recipientUserId,
    { v: 1, type: 'text', body: text },
    clientMessageId,
  );
}

/** Same send path for any envelope; `mediaUploadIds` are the already-uploaded encrypted blobs to attach. */
export async function sendEncryptedEnvelope(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  envelope: PlaintextEnvelope,
  clientMessageId: string,
  mediaUploadIds: string[] = [],
) {
  try {
    return await encryptAndSend(
      syncEngine,
      deviceId,
      conversationId,
      recipientUserId,
      envelope,
      clientMessageId,
      mediaUploadIds,
    );
  } catch (error) {
    if (!isMembershipChangePending(error)) throw error;

    // A member is being removed, so anything encrypted now would still be readable to them
    await syncEngine.reconcileMembership({ conversationId });
    return encryptAndSend(
      syncEngine,
      deviceId,
      conversationId,
      recipientUserId,
      envelope,
      clientMessageId,
      mediaUploadIds,
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
  recipientUserId: UserId | UserId[],
  envelope: PlaintextEnvelope,
  clientMessageId: string,
  mediaUploadIds: string[],
) {
  await ensureConversationGroup(syncEngine, conversationId, recipientUserId);

  const { wireBytes, epoch } = await syncEngine.encryptMessage(conversationId, envelope);

  const response = await api.sendChatMessage(conversationId, {
    ciphertext: bytesToBase64(wireBytes),
    contentType: 'TEXT',
    clientMessageId,
    encryptionMeta: senderMeta(deviceId),
    ...(mediaUploadIds.length
      ? { media: mediaUploadIds.map((mediaUploadId, sortOrder) => ({ mediaUploadId, sortOrder })) }
      : {}),
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
