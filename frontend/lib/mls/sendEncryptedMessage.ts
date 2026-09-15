import { api } from '../api';
import { bytesToBase64 } from './base64';
import type { SyncEngine } from './syncEngine';
import { EncryptedIndexedDbMessagePlaintextStore } from './messagePlaintextStore';
import type { ConversationId, DeviceId } from './types';

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

/**
 * Encrypts `text` for `conversationId`, sends it, and saves the plaintext
 * locally under the server-assigned message id - the sender never decrypts
 * its own message later (that generation's key is already gone by the time
 * encryptMessage returns), so this is the only chance to ever cache it.
 */
export async function sendEncryptedChatMessage(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  text: string,
) {
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
