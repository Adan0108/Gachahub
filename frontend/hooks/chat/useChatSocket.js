'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queries';
import { useSharedSocket } from '../../lib/socket/sharedSocket';
import { typingSignal } from '../../lib/chat/chatTypingSignal';

// How long a typing:start this tab sent stays valid without a fresh ping before it emits
// typing:stop on its own - matches the usual "stopped typing" idle window other chat apps use.
const TYPING_STOP_AFTER_IDLE_MS = 3000;
// Defensive only: clears a peer's typing state on this end even if their typing:stop never
// arrives (a dropped event, a crash) - the backend's own disconnect handling clears its side,
// but doesn't broadcast a stop, so without this a stuck "typing..." would never go away.
const TYPING_EXPIRE_MS = 6000;
// While someone keeps typing past this long, re-announce typing:start rather than relying on the
// single one sent when they started - otherwise a peer's defensive TYPING_EXPIRE_MS above fires
// and hides "is typing..." after 6s even though nothing ever told it to stop. Must stay above the
// backend's own throttle floor (2s between repeats of the same event) or the re-announce gets
// silently dropped server-side.
const TYPING_REFRESH_MS = 2500;

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
  const socket = useSharedSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    // The socket is shared, so only this hook's own listeners come off when it unmounts.
    const removers = [];
    const on = (event, handler) => {
      socket.on(event, handler);
      removers.push(() => socket.off(event, handler));
    };

    on('message:created', (event) => {
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
    on('reaction:added', refetchConversationMessages);
    on('reaction:removed', refetchConversationMessages);
    on('message:deleted', refetchConversationMessages);
    on('message:edited', refetchConversationMessages);

    // The other side accepted a message request this tab sent - a one-shot notice, not steady
    // state, so the chat page reads it once via the same cache-write bridge and clears it.
    on('request:accepted', (event) => {
      queryClient.setQueryData(queryKeys.chatRequestAccepted(event.conversationId), event);
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations });
    });

    // Outgoing: the composer (mounted separately, in app/chat/page.jsx) pings typingSignal while
    // the user types; turn that into throttled typing:start/typing:stop on this one socket.
    const typingStopTimers = new Map();
    const typingLastStartedAt = new Map();
    const unsubscribeTyping = typingSignal.subscribe((conversationId, active) => {
      clearTimeout(typingStopTimers.get(conversationId));
      typingStopTimers.delete(conversationId);
      if (active) {
        const lastStartedAt = typingLastStartedAt.get(conversationId) ?? 0;
        if (Date.now() - lastStartedAt >= TYPING_REFRESH_MS) {
          typingLastStartedAt.set(conversationId, Date.now());
          socket.emit('typing:start', { conversationId });
        }
        typingStopTimers.set(
          conversationId,
          setTimeout(() => {
            typingLastStartedAt.delete(conversationId);
            typingStopTimers.delete(conversationId);
            socket.emit('typing:stop', { conversationId });
          }, TYPING_STOP_AFTER_IDLE_MS),
        );
        return;
      }
      if (typingLastStartedAt.delete(conversationId)) {
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
    on('typing:start', (event) => {
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
    on('typing:stop', (event) => {
      const timerKey = `${event.conversationId}:${event.userId}`;
      clearTimeout(typingExpireTimers.get(timerKey));
      typingExpireTimers.delete(timerKey);
      setTypingUser(event.conversationId, event.userId, false);
    });

    return () => {
      unsubscribeTyping();
      typingStopTimers.forEach(clearTimeout);
      typingExpireTimers.forEach(clearTimeout);
      removers.forEach((remove) => remove());
    };
  }, [socket, queryClient]);
}
