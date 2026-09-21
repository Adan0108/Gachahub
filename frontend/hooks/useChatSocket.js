"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { useCurrentUser } from "./useCurrentUser";
import { API_BASE_URL } from "../lib/api";
import { queryKeys } from "../lib/queries";

/**
 * Live push for new chat messages, so one shows up as soon as it's sent
 * instead of waiting for the next poll. The backend already emits
 * "message:created" (with the full ciphertext) to the recipient's room -
 * this just listens and merges it straight into the query cache.
 *
 * The poll intervals in lib/queries.js stay in place as a fallback: a
 * socket that's disconnected at the moment of send (reload, network blip)
 * just misses the push, with no retry/queue on the backend side - REST
 * polling is what actually guarantees delivery, this is purely a latency
 * improvement on top of it.
 */
export function useChatSocket() {
  const { user, isAuthenticated } = useCurrentUser();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      return undefined;
    }

    const socket = io(API_BASE_URL, { withCredentials: true });

    // This login was ended from another device: leave at once, with a full reload so nothing stays in memory.
    socket.on("session:revoked", () => {
      queryClient.setQueryData(queryKeys.currentUser, null);
      window.location.assign("/login");
    });

    socket.on("message:created", (event) => {
      queryClient.setQueryData(queryKeys.chatMessages(event.conversationId), (old) => {
        if (!old || old.items.some((item) => item.id === event.messageId)) {
          return old;
        }
        return {
          ...old,
          items: [
            ...old.items,
            {
              id: event.messageId,
              conversationId: event.conversationId,
              senderId: event.senderId,
              ciphertext: event.ciphertext,
              encryptionMeta: event.encryptionMeta,
              contentType: event.contentType,
              createdAt: event.createdAt,
              clientMessageId: event.clientMessageId,
              replyToId: event.replyToId,
              media: event.media,
            },
          ],
        };
      });
      // Sidebar preview text/unread badge and the requests list aren't
      // worth hand-merging - both are cheap GETs, just refetch them.
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations });
      queryClient.invalidateQueries({ queryKey: queryKeys.chatRequests });
    });

    return () => {
      socket.disconnect();
    };
  }, [isAuthenticated, user?.id, queryClient]);
}
