"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "../../lib/api";
import { addMessageToCache } from "../../lib/chat/messageCache";
import type { PreparedFiles, AttachmentStage } from "../../lib/mls/media/prepareAttachments";
import type { LinkPreviewData } from "../../lib/mls/media/prepareLinkPreview";
import { sendAttachmentsWithCache } from "../../lib/mls/messaging/sendEncryptedAttachment";
import { sendEncryptedChatMessage } from "../../lib/mls/messaging/sendEncryptedMessage";
import { previewForSend, type PreparedPreviews } from "../../lib/mls/messaging/sendLinkPreview";
import type { SyncEngine } from "../../lib/mls/sync/syncEngine";
import { queryKeys } from "../../lib/queries";
import type { ThreadMessage } from "./useThreadData";
import { useSendCooldown } from "./useSendCooldown";

export interface SendDraft {
  preview?: LinkPreviewData;
  text: string;
  clientId: string;
  files: File[];
  replyToId?: string;
  mentionUserIds?: string[];
}

export interface PendingMessage extends SendDraft {
  conversationId: string;
  failed?: boolean;
  stage?: AttachmentStage;
}

type SendResponse = { conversationId?: string; message: ThreadMessage };

/**
 * Sending in the open chat: each message shows as a pending bubble at once, then goes out
 * encrypted (with its pictures or link card), under the send cooldown; a failed one can be retried
 * without uploading anything again.
 */
export function useChatSend({
  conversationId,
  syncEngine,
  deviceId,
  recipientIds,
  withDeviceRecovery,
}: {
  conversationId: string;
  syncEngine: SyncEngine | undefined;
  deviceId: string | undefined;
  recipientIds: () => string | string[];
  withDeviceRecovery: <Result>(action: () => Promise<Result>) => Promise<Result>;
}) {
  const queryClient = useQueryClient();
  // Sent messages awaiting the network, keyed by a client-side id.
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  // Uploaded attachment entries by clientId, so a retry re-sends without re-uploading.
  const uploadedAttachmentsRef = useRef(new Map<string, PreparedFiles>());
  // Link preview cards already prepared by clientId, so a retry re-sends the same card without uploading its picture again.
  const preparedPreviewsRef = useRef<PreparedPreviews>(new Map());
  const cooldown = useSendCooldown();

  const sendMessage = useMutation({
    mutationFn: ({ text, clientId, files, replyToId, preview, mentionUserIds }: SendDraft) =>
      withDeviceRecovery(async (): Promise<SendResponse> => {
        if (files?.length) {
          return sendAttachmentsWithCache({
            syncEngine: syncEngine!,
            deviceId: deviceId!,
            conversationId,
            recipientUserId: recipientIds(),
            files,
            caption: text,
            clientMessageId: clientId,
            uploaded: uploadedAttachmentsRef.current,
            onStage: (stage) =>
              setPendingMessages((prev) =>
                prev.map((item) => (item.clientId === clientId ? { ...item, stage } : item)),
              ),
          }) as Promise<SendResponse>;
        }
        const card = await previewForSend({
          preview,
          clientMessageId: clientId,
          prepared: preparedPreviewsRef.current,
        });
        return sendEncryptedChatMessage({
          syncEngine: syncEngine!,
          deviceId: deviceId!,
          conversationId,
          recipientUserId: recipientIds(),
          text,
          clientMessageId: clientId,
          replyToId,
          preview: card,
          mentionUserIds,
        }) as Promise<SendResponse>;
      }),
    onSuccess: (response, variables) => {
      uploadedAttachmentsRef.current.delete(variables.clientId);
      preparedPreviewsRef.current.delete(variables.clientId);
      setPendingMessages((prev) =>
        prev.filter((pending) => pending.clientId !== variables.clientId),
      );
      // Merged into the cache instead of refetching.
      void addMessageToCache(
        queryClient,
        response.conversationId ?? conversationId,
        response.message,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations });
    },
    onError: (error, variables) => {
      const { status, retryAfterSeconds } = error as ApiError;
      if (status === 429) cooldown.noteRateLimited(retryAfterSeconds);
      setPendingMessages((prev) =>
        prev.map((pending) =>
          pending.clientId === variables.clientId ? { ...pending, failed: true } : pending,
        ),
      );
    },
  });

  return {
    pendingMessages,
    sendError: sendMessage.error,
    cooldown,
    /** Shows the message as pending and sends it; false, sending nothing, while cooling down. */
    send: (draft: Omit<SendDraft, "clientId">) => {
      if (!cooldown.tryConsume()) return false;
      const clientId = crypto.randomUUID();
      setPendingMessages((prev) => [...prev, { ...draft, clientId, conversationId }]);
      sendMessage.mutate({ ...draft, clientId });
      return true;
    },
    retry: (pending: PendingMessage) => {
      if (!cooldown.tryConsume()) return;
      setPendingMessages((prev) =>
        prev.map((item) =>
          item.clientId === pending.clientId ? { ...item, failed: false } : item,
        ),
      );
      sendMessage.mutate({
        text: pending.text,
        clientId: pending.clientId,
        files: pending.files,
        replyToId: pending.replyToId,
        preview: pending.preview,
        mentionUserIds: pending.mentionUserIds,
      });
    },
  };
}
