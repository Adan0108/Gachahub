'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useCurrentUser } from './useCurrentUser';
import { API_BASE_URL } from '../lib/api';
import { queryKeys } from '../lib/queries';
import { MAX_RECONNECT_ATTEMPTS, reconnectDelayMs } from '../lib/socketReconnect';
import { typingSignal } from '../lib/chatTypingSignal';

// How long a typing:start this tab sent stays valid without a fresh ping before it emits
// typing:stop on its own - matches the usual "stopped typing" idle window other chat apps use.
const TYPING_STOP_AFTER_IDLE_MS = 3000;
// Defensive only: clears a peer's typing state on this end even if their typing:stop never
// arrives (a dropped event, a crash) - the backend's own disconnect handling clears its side,
// but doesn't broadcast a stop, so without this a stuck "typing..." would never go away.
const TYPING_EXPIRE_MS = 6000;

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

    // Reactions and deletes are rare compared to new messages, so a full
    // refetch of that conversation's page is simpler than hand-patching one
    // message's fields, and still just as live.
    const refetchConversationMessages = (event) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(event.conversationId) });
    };
    socket.on('reaction:added', refetchConversationMessages);
    socket.on('reaction:removed', refetchConversationMessages);
    socket.on('message:deleted', refetchConversationMessages);
    socket.on('message:edited', refetchConversationMessages);

    // The other side accepted a message request this tab sent - a one-shot notice, not steady
    // state, so the chat page reads it once via the same cache-write bridge and clears it.
    socket.on('request:accepted', (event) => {
      queryClient.setQueryData(queryKeys.chatRequestAccepted(event.conversationId), event);
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations });
    });

    // Outgoing: the composer (mounted separately, in app/chat/page.jsx) pings typingSignal while
    // the user types; turn that into throttled typing:start/typing:stop on this one socket.
    const typingStopTimers = new Map();
    const typingStarted = new Set();
    const unsubscribeTyping = typingSignal.subscribe((conversationId, active) => {
      clearTimeout(typingStopTimers.get(conversationId));
      typingStopTimers.delete(conversationId);
      if (active) {
        if (!typingStarted.has(conversationId)) {
          typingStarted.add(conversationId);
          socket.emit('typing:start', { conversationId });
        }
        typingStopTimers.set(
          conversationId,
          setTimeout(() => {
            typingStarted.delete(conversationId);
            typingStopTimers.delete(conversationId);
            socket.emit('typing:stop', { conversationId });
          }, TYPING_STOP_AFTER_IDLE_MS),
        );
        return;
      }
      if (typingStarted.delete(conversationId)) {
        socket.emit('typing:stop', { conversationId });
      }
    });

    // Incoming: who's typing, per conversation, straight into the query cache - the chat page
    // reads it with a plain useQuery the same way it reads everything else socket-pushed.
    const typingExpireTimers = new Map();
    const setTypingUser = (conversationId, userId, isTyping) => {
      queryClient.setQueryData(queryKeys.chatTyping(conversationId), (old = []) =>
        isTyping
          ? old.includes(userId)
            ? old
            : [...old, userId]
          : old.filter((id) => id !== userId),
      );
    };
    socket.on('typing:start', (event) => {
      const timerKey = `${event.conversationId}:${event.userId}`;
      clearTimeout(typingExpireTimers.get(timerKey));
      setTypingUser(event.conversationId, event.userId, true);
      typingExpireTimers.set(
        timerKey,
        setTimeout(() => {
          typingExpireTimers.delete(timerKey);
          setTypingUser(event.conversationId, event.userId, false);
        }, TYPING_EXPIRE_MS),
      );
    });
    socket.on('typing:stop', (event) => {
      const timerKey = `${event.conversationId}:${event.userId}`;
      clearTimeout(typingExpireTimers.get(timerKey));
      typingExpireTimers.delete(timerKey);
      setTypingUser(event.conversationId, event.userId, false);
    });

    return () => {
      clearTimeout(reconnectTimer);
      unsubscribeTyping();
      typingStopTimers.forEach(clearTimeout);
      typingExpireTimers.forEach(clearTimeout);
      socket.disconnect();
    };
  }, [isAuthenticated, user?.id, queryClient]);
}
