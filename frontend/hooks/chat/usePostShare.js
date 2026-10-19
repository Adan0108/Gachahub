"use client";

import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { otherActiveMemberIds } from "../../lib/chat/chatDisplay";
import { directConversationWith, shareStatus } from "../../lib/chat/shareTargets";
import { withDeviceRecovery } from "../../lib/mls/device/withDeviceRecovery";
import { sendEncryptedPostShare } from "../../lib/mls/messaging/sendPostShare";
import { queries, queryKeys } from "../../lib/queries";
import { useCurrentUser } from "../useCurrentUser";
import { useDeviceIdentity } from "./useDeviceIdentity";
import { useSyncEngine } from "./useSyncEngine";

// SYSTEM renders as a "Conversation started" divider; the real content goes in the next message.
const STARTER_MESSAGE = { ciphertext: "placeholder-pending-mls-setup", contentType: "SYSTEM" };

/** How one send ended. */
export const SHARE_RESULT = {
  SENT: "sent",
  /** They are not a mutual follow: a message request went out, and the post can be sent once they accept. */
  REQUESTED: "requested",
  /** A chat that exists but nobody can receive in yet. */
  WAITING: "waiting",
  FAILED: "failed",
};

/**
 * Sends a post into conversations, or to people you have not messaged yet. Each send is
 * encrypted like any message; a retry of the same send reuses its client id, so a lost
 * response never delivers it twice.
 */
export function usePostShare() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { credential, isReady, error: deviceError, reprovision } = useDeviceIdentity();
  const syncEngine = useSyncEngine();
  const clientIdsRef = useRef(new Map());

  const clientIdFor = (postId, targetKey) => {
    const key = `${postId}:${targetKey}`;
    if (!clientIdsRef.current.has(key)) clientIdsRef.current.set(key, crypto.randomUUID());
    return { key, clientMessageId: clientIdsRef.current.get(key) };
  };

  // Where a person's direct chat is, creating the message request when there is none yet.
  const resolveDirectChat = async (person) => {
    const lists = await Promise.all([
      queryClient.fetchQuery(queries.chatConversations()),
      queryClient.fetchQuery(queries.chatRequests()),
      queryClient.fetchQuery(queries.chatArchivedConversations()),
    ]);
    const existing = directConversationWith(lists, person.id);
    if (existing) return { conversation: existing };

    const created = await api.createDirectMessage({
      recipientUserId: person.id,
      message: STARTER_MESSAGE,
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations });
    queryClient.invalidateQueries({ queryKey: queryKeys.chatRequests });

    if (created.recipientState === "PENDING") return { requested: true };
    return { conversationId: created.conversationId, recipientIds: [person.id] };
  };

  /** Sends to one target: `{ key, conversation }` for a chat you have, or `{ key, person }` for someone new. */
  const sendTo = async (target, share) => {
    const { key, clientMessageId } = clientIdFor(share.postId, target.key);

    try {
      let conversationId;
      let recipientIds;

      if (target.person) {
        const resolved = await resolveDirectChat(target.person);
        if (resolved.requested) return { status: SHARE_RESULT.REQUESTED };
        if (resolved.conversation) {
          const status = shareStatus(resolved.conversation, user?.id);
          if (!status.ok) return { status: SHARE_RESULT.WAITING, reason: status.reason };
          conversationId = resolved.conversation.id;
          recipientIds = otherActiveMemberIds(resolved.conversation, user?.id);
        } else {
          ({ conversationId, recipientIds } = resolved);
        }
      } else {
        const status = shareStatus(target.conversation, user?.id);
        if (!status.ok) return { status: SHARE_RESULT.WAITING, reason: status.reason };
        conversationId = target.conversation.id;
        recipientIds = otherActiveMemberIds(target.conversation, user?.id);
      }

      await withDeviceRecovery(
        () =>
          sendEncryptedPostShare(
            syncEngine,
            credential.deviceId,
            conversationId,
            recipientIds,
            share,
            clientMessageId,
          ),
        reprovision,
      );

      clientIdsRef.current.delete(key);
      queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(conversationId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations });
      return { status: SHARE_RESULT.SENT };
    } catch (error) {
      return {
        status: SHARE_RESULT.FAILED,
        reason: error instanceof Error ? error.message : "Could not send this.",
      };
    }
  };

  return {
    canSend: Boolean(isReady && syncEngine && credential),
    deviceError,
    sendTo,
  };
}
