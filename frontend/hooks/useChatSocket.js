'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useCurrentUser } from './useCurrentUser';
import { API_BASE_URL } from '../lib/api';
import { queryKeys } from '../lib/queries';
import { MAX_RECONNECT_ATTEMPTS, reconnectDelayMs } from '../lib/socketReconnect';

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
    let reconnectAttempts = 0;
    let reconnectTimer;

    // This login was ended from another device: leave at once, with a full reload so nothing stays in memory.
    const signOutHere = () => {
      queryClient.setQueryData(queryKeys.currentUser, null);
      window.location.assign('/login');
    };
    // Only this explicit event signs the browser out - a reconnect with a dead login receives it
    // again from the gateway, and a plain drop or backend hiccup must never log anyone out.
    socket.on('session:revoked', signOutHere);

    // A real, live connection resets the budget - only a run of CONSECUTIVE failures should ever
    // exhaust it, not the cumulative count over a tab's whole lifetime.
    socket.on('connect', () => {
      reconnectAttempts = 0;
    });

    // socket.io does NOT auto-reconnect after a server-initiated disconnect (the gateway calls
    // socket.disconnect() on both a backend hiccup and a dead login) - without this, that tab stays
    // cut off from new messages and future sign-out events until the page is reloaded by hand. A dead
    // login just gets session:revoked again on the reconnect the gateway sees.
    socket.on('disconnect', (reason) => {
      if (reason !== 'io server disconnect') return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;

      const delay = reconnectDelayMs(reconnectAttempts);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => socket.connect(), delay);
    });

    socket.on('message:created', (event) => {
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
      clearTimeout(reconnectTimer);
      socket.disconnect();
    };
  }, [isAuthenticated, user?.id, queryClient]);
}
