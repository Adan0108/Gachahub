import { api } from '../../api';
import { bytesToBase64 } from '../storage/base64';
import { ensureConversationGroup } from './ensureConversationGroup';
import { buildEditEnvelope } from './editEnvelope';
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
  replyToId?: string,
) {
  return sendEncryptedEnvelope(
    syncEngine,
    deviceId,
    conversationId,
    recipientUserId,
    { v: 1, type: 'text', body: text },
    clientMessageId,
    [],
    replyToId,
  );
}

type WireMessage = { ciphertext: string; encryptionMeta: ReturnType<typeof senderMeta> };
type Submit = (wire: WireMessage) => Promise<{ message: { id: string } }>;

/** Same send path for any envelope; `mediaUploadIds` are the already-uploaded encrypted blobs to attach. */
export function sendEncryptedEnvelope(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  envelope: PlaintextEnvelope,
  clientMessageId: string,
  mediaUploadIds: string[] = [],
  replyToId?: string,
) {
  return encryptSubmitAndCache(syncEngine, deviceId, conversationId, recipientUserId, envelope, (wire) =>
    api.sendChatMessage(conversationId, {
      ...wire,
      contentType: 'TEXT',
      clientMessageId,
      ...(replyToId ? { replyToId } : {}),
      ...(mediaUploadIds.length
        ? { media: mediaUploadIds.map((mediaUploadId, sortOrder) => ({ mediaUploadId, sortOrder })) }
        : {}),
    }),
  );
}

/** Sends a new body for one of your own text messages: encrypted like any message, stored by the server as a hidden edit. `n` is which edit of the message this is. */
export function sendEncryptedEdit(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  edit: { targetMessageId: string; text: string; n: number },
  clientMessageId: string,
) {
  return encryptSubmitAndCache(
    syncEngine,
    deviceId,
    conversationId,
    recipientUserId,
    buildEditEnvelope(edit),
    (wire) => api.editChatMessage(edit.targetMessageId, { ...wire, clientMessageId }),
  );
}

/** Encrypts, submits and caches the plaintext, re-trying once after catching up on a pending membership change. */
async function encryptSubmitAndCache(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  envelope: PlaintextEnvelope,
  submit: Submit,
) {
  try {
    return await encryptAndSend(syncEngine, deviceId, conversationId, recipientUserId, envelope, submit);
  } catch (error) {
    if (!isMembershipChangePending(error)) throw error;

    // A member is being removed, so anything encrypted now would still be readable to them
    await syncEngine.reconcileMembership({ conversationId });
    return encryptAndSend(syncEngine, deviceId, conversationId, recipientUserId, envelope, submit);
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
  submit: Submit,
) {
  await ensureConversationGroup(syncEngine, conversationId, recipientUserId);

  const { wireBytes, epoch } = await syncEngine.encryptMessage(conversationId, envelope);

  const response = await submit({
    ciphertext: bytesToBase64(wireBytes),
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
