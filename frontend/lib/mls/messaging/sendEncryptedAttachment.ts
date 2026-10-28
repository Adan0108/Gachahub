import { api } from '../../api';
import { startTiming } from '../../chat/chatTiming';
import { buildAttachmentEnvelope, envelopeBlobIds } from '../media/attachmentEnvelope';
import {
  prepareAttachments,
  type AttachmentStage,
  type PreparedFiles,
} from '../media/prepareAttachments';
import type { AttachmentFile, ConversationId, DeviceId, UserId } from '../contract/types';
import type { SyncEngine } from '../sync/syncEngine';
import { sendEncryptedEnvelope } from './sendEncryptedMessage';

/** Encrypts and uploads the files; `done` is filled per file so retries skip what already uploaded. */
export function uploadEncryptedAttachments(
  files: File[],
  onStage?: (stage: AttachmentStage) => void,
  done?: PreparedFiles,
): Promise<AttachmentFile[]> {
  return prepareAttachments(files, (blobs) => api.uploadChatBlobs(blobs), onStage, done);
}

/** Sends already-uploaded attachments as one MLS message; the file keys travel only inside the envelope. */
export function sendEncryptedAttachmentMessage(
  syncEngine: SyncEngine,
  deviceId: DeviceId,
  conversationId: ConversationId,
  recipientUserId: UserId | UserId[],
  attachment: { files: AttachmentFile[]; caption: string },
  clientMessageId: string,
) {
  return sendEncryptedEnvelope(
    syncEngine,
    deviceId,
    conversationId,
    recipientUserId,
    buildAttachmentEnvelope(attachment.files, attachment.caption),
    clientMessageId,
    envelopeBlobIds(attachment.files),
  );
}

/** Outgoing attachment send with a per-message cache, so a retry re-sends without re-uploading finished files. */
export async function sendAttachmentsWithCache(params: {
  syncEngine: SyncEngine;
  deviceId: DeviceId;
  conversationId: ConversationId;
  recipientUserId: UserId | UserId[];
  files: File[];
  caption: string;
  clientMessageId: string;
  uploaded: Map<string, PreparedFiles>;
  onStage?: (stage: AttachmentStage) => void;
}) {
  const done = params.uploaded.get(params.clientMessageId) ?? new Map();
  params.uploaded.set(params.clientMessageId, done);
  const stopAll = startTiming('attachment send', { files: params.files.length });
  const stopUpload = startTiming('attachments encrypted and uploaded', { files: params.files.length });
  const prepared = await uploadEncryptedAttachments(params.files, params.onStage, done);
  stopUpload();

  const sent = sendEncryptedAttachmentMessage(
    params.syncEngine,
    params.deviceId,
    params.conversationId,
    params.recipientUserId,
    { files: prepared, caption: params.caption },
    params.clientMessageId,
  );
  return sent.finally(() => stopAll());
}
