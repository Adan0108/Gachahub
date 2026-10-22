import { api } from "../../api";
import {
  assertMessageSize,
  MAX_CIPHERTEXT_CHARS,
  SEND_ARRIVAL_MARGIN_MS,
  SEND_LIMIT,
  SEND_WINDOW_MS,
} from "../../chat/messageLimits";
import { bytesToBase64 } from "../storage/base64";
import { ensureConversationGroup } from "./ensureConversationGroup";
import { buildEditEnvelope } from "./editEnvelope";
import { buildTextEnvelope, previewBlobIds } from "./linkPreviewEnvelope";
import { senderMeta } from "./messageOrigin";
import type { SyncEngine } from "../sync/syncEngine";
import { EncryptedIndexedDbMessagePlaintextStore } from "../storage/messagePlaintextStore";
import type {
  ConversationId,
  DeviceId,
  LinkPreviewRef,
  PlaintextEnvelope,
  UserId,
} from "../contract/types";

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

// Sends of one conversation go one at a time, in the order they were typed. Sent all at once they
// queue on the server's conversation lock, and the last ones time out here while the server still
// stores them, leaving this device without their text.
const sendQueues = new Map<ConversationId, Promise<unknown>>();

function oneAtATime<T>(conversationId: ConversationId, task: () => Promise<T>): Promise<T> {
  const run = (sendQueues.get(conversationId) ?? Promise.resolve()).then(task, task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  sendQueues.set(conversationId, settled);
  void settled.then(() => {
    if (sendQueues.get(conversationId) === settled) sendQueues.delete(conversationId);
  });
  return run;
}

// When this device's recent sends reached the server, or are booked to: shared by every
// conversation, because the server's limit is per user.
const sendSlots: number[] = [];

/**
 * Waits until one more send stays within the server's limit. Messages typed one per second can
 * still reach it in a rush once a slow send ahead of them finishes; spaced out here, the server
 * never refuses them and they just show as sending a little longer.
 */
async function waitForSendSlot() {
  const now = Date.now();
  const windowMs = SEND_WINDOW_MS + SEND_ARRIVAL_MARGIN_MS;
  while (sendSlots.length > 0 && now - sendSlots[0]! >= windowMs) sendSlots.shift();
  const slot = Math.max(now, (sendSlots.at(-SEND_LIMIT) ?? -Infinity) + windowMs);
  sendSlots.push(slot);
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/** A timeout or a dropped connection: the server may have stored the message anyway. */
function mightHaveLanded(error: unknown): boolean {
  return (
    error instanceof TypeError || (error as { name?: unknown } | null)?.name === "TimeoutError"
  );
}

/** Encrypts `text` for `conversationId`, sends it, and saves the plaintext locally under the server-assigned message id - the sender never decrypts its own message later (that generation's key is already gone by the time encryptMessage returns), so this is the only chance to ever cache it. `clientMessageId` must stay the same across retries of one message: the backend returns the message it already stored for that id, so a retry after a lost response is not delivered twice */
export function sendEncryptedChatMessage(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  text: string,
  clientMessageId: string,
  replyToId?: string,
  preview?: LinkPreviewRef,
  mentionUserIds: UserId[] = [],
) {
  return sendEncryptedEnvelope(
    syncEngine,
    deviceId,
    conversationId,
    recipientUserId,
    buildTextEnvelope(text, preview),
    clientMessageId,
    previewBlobIds(preview),
    replyToId,
    mentionUserIds,
  );
}

type WireMessage = { ciphertext: string; encryptionMeta: ReturnType<typeof senderMeta> };
type SendResult = { message: { id: string } };
type Submit<Response extends SendResult> = (wire: WireMessage) => Promise<Response>;

/** Same send path for any envelope; `mediaUploadIds` are the already-uploaded encrypted blobs to attach. `mentionUserIds` travel in the clear: the server cannot read the text to find them. */
export function sendEncryptedEnvelope(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  envelope: PlaintextEnvelope,
  clientMessageId: string,
  mediaUploadIds: string[] = [],
  replyToId?: string,
  mentionUserIds: UserId[] = [],
) {
  return encryptSubmitAndCache(
    syncEngine,
    deviceId,
    conversationId,
    recipientUserId,
    envelope,
    (wire) =>
      api.sendChatMessage(conversationId, {
        ...wire,
        contentType: "TEXT",
        clientMessageId,
        ...(replyToId ? { replyToId } : {}),
        ...(mentionUserIds.length ? { mentionUserIds } : {}),
        ...(mediaUploadIds.length
          ? {
              media: mediaUploadIds.map((mediaUploadId, sortOrder) => ({
                mediaUploadId,
                sortOrder,
              })),
            }
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
async function encryptSubmitAndCache<Response extends SendResult>(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  envelope: PlaintextEnvelope,
  submit: Submit<Response>,
) {
  assertMessageSize(envelope);
  return oneAtATime(conversationId, async () => {
    try {
      return await encryptAndSend(
        syncEngine,
        deviceId,
        conversationId,
        recipientUserId,
        envelope,
        submit,
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
        submit,
      );
    }
  });
}

function isMembershipChangePending(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "MEMBERSHIP_CHANGE_PENDING"
  );
}

async function encryptAndSend<Response extends SendResult>(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  envelope: PlaintextEnvelope,
  submit: Submit<Response>,
) {
  await ensureConversationGroup(syncEngine, conversationId, recipientUserId);

  const { wireBytes, epoch } = await syncEngine.encryptMessage(conversationId, envelope);

  const ciphertext = bytesToBase64(wireBytes);
  if (ciphertext.length > MAX_CIPHERTEXT_CHARS) {
    throw new Error("Encrypted message is too large. Shorten the text or caption and try again.");
  }

  const wire = { ciphertext, encryptionMeta: senderMeta(deviceId) };
  // The same ciphertext again: the server answers with the message it already stored for this
  // clientMessageId, so its text is still kept here instead of the send showing as failed.
  await waitForSendSlot();
  const response = await submit(wire).catch(async (error: unknown) => {
    if (!mightHaveLanded(error)) throw error;
    await waitForSendSlot();
    return submit(wire);
  });

  // The server has the message: a local save error must not report the send as failed
  await plaintextStore
    .save({
      messageId: response.message.id,
      conversationId,
      senderDeviceId: deviceId,
      epoch,
      envelope,
    })
    .catch((error: unknown) =>
      console.warn(`Sent message ${response.message.id} could not be kept on this device`, error),
    );

  return response;
}
