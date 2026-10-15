"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { decryptPendingMessages, type PendingMessageRow } from "../../lib/chat/backgroundDecrypt";
import { api } from "../../lib/api";
import { queries } from "../../lib/queries";
import { EncryptedIndexedDbMessagePlaintextStore } from "../../lib/mls/storage/messagePlaintextStore";
import type { ConversationId } from "../../lib/mls/contract/types";
import { useDeviceIdentity } from "./useDeviceIdentity";
import { useSyncEngine } from "./useSyncEngine";

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

// Conversations this user has joined; a pending request has no group state here yet.
const JOINED_STATES = new Set(["ACTIVE", "ARCHIVED"]);

interface ListedConversation {
  id: string;
  participantState?: string | null;
  unreadCount?: number;
  lastMessage?: (PendingMessageRow & { senderId: string }) | null;
}

/**
 * Decrypts new messages in conversations that are not open, so the list can show their text instead
 * of "Encrypted message". One conversation at a time, once per newest message; the open chat does
 * its own decrypting and takes over whatever this has not finished.
 */
export function useBackgroundDecrypt(
  conversations: ListedConversation[] | undefined,
  userId: string | undefined,
  openConversationId: string,
) {
  const queryClient = useQueryClient();
  const syncEngine = useSyncEngine();
  const ownDeviceId = useDeviceIdentity().credential?.deviceId;
  const tried = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!syncEngine || !userId) return;

    for (const conversation of conversations ?? []) {
      const last = conversation.lastMessage;
      if (!last || last.status === "DELETED") continue;
      if (conversation.id === openConversationId) continue;
      if (!JOINED_STATES.has(conversation.participantState ?? "")) continue;
      if ((conversation.unreadCount ?? 0) === 0 || last.senderId === userId) continue;

      const attempt = `${conversation.id}:${last.id}`;
      if (tried.current.has(attempt)) continue;
      tried.current.add(attempt);

      queue.current = queue.current
        .then(async () => {
          if (!active.current || (await plaintextStore.get(last.id))) return;
          const page = (await queryClient.fetchQuery(queries.chatMessages(conversation.id))) as {
            items: PendingMessageRow[];
          };
          if (!active.current) return;
          // This device has them now, whether or not they decrypt: tell the senders, even if they sent while we were offline.
          const received = page.items
            .filter((message) => message.senderId !== userId && message.status !== "DELETED")
            .map((message) => message.id);
          if (received.length > 0) api.markChatDelivered(received).catch(() => {});
          await decryptPendingMessages({
            engine: syncEngine,
            store: plaintextStore,
            conversationId: conversation.id as ConversationId,
            messages: page.items,
            ownDeviceId,
            currentUserId: userId,
          });
        })
        .catch((error: unknown) =>
          console.warn(`Could not decrypt ${conversation.id} in the background`, error),
        );
    }
  }, [conversations, userId, openConversationId, syncEngine, ownDeviceId, queryClient]);
}
