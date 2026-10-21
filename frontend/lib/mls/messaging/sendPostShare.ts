import type { ConversationId, DeviceId, UserId } from "../contract/types";
import type { SyncEngine } from "../sync/syncEngine";
import { buildPostShareEnvelope } from "./postShareEnvelope";
import { sendEncryptedEnvelope } from "./sendEncryptedMessage";

/** Sends a post into a conversation as a card, with an optional note; `clientMessageId` stays the same across retries of one send. */
export function sendEncryptedPostShare(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  share: { postId: string; caption?: string },
  clientMessageId: string,
) {
  return sendEncryptedEnvelope(
    syncEngine,
    deviceId,
    conversationId,
    recipientUserId,
    buildPostShareEnvelope(share.postId, share.caption),
    clientMessageId,
  );
}
