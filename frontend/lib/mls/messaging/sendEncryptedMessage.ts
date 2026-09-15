import { api } from '../../api';
import { bytesToBase64 } from '../storage/base64';
import { ensureConversationGroup } from './ensureConversationGroup';
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
) {
  await ensureConversationGroup(syncEngine, conversationId, recipientUserId);

  const envelope = { v: 1 as const, type: 'text' as const, body: text };
  const wireBytes = await syncEngine.encryptMessage(conversationId, envelope);
  const epoch = await syncEngine.getCurrentEpoch(conversationId);

  const response = await api.sendChatMessage(conversationId, {
    ciphertext: bytesToBase64(wireBytes),
    contentType: 'TEXT',
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
