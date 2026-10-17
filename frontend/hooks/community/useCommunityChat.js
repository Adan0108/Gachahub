"use client";

import { useCallback, useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { withOptimisticReaction } from "../../lib/chat/chatReactions";
import {
  messagesOf,
  olderPageParam,
  patchMessage,
  upsertMessage,
} from "../../lib/community/communityChat";
import { queries, queryKeys } from "../../lib/queries";
import { useSharedSocket } from "../../lib/socket/sharedSocket";
import { useCurrentUser } from "../useCurrentUser";

const PAGE_SIZE = 50;
// The server says when a room changed; this slower pull only catches whatever a push missed.
const LATEST_POLL_MS = 60_000;
// A burst of changes (several people typing at once) is one pull.
const PUSH_PULL_DELAY_MS = 150;

/**
 * One community's chat room: its messages (newest page first, older ones on demand), sending with
 * a visible "sending / failed" state, and edit, remove and reactions. Everything stays in the
 * React Query cache so the room opens instantly the second time.
 */
export function useCommunityChat(slug, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const channelsQuery = useQuery({ ...queries.communityChannels(slug), enabled });
  // One room per community for now; the API already lists several.
  const channel = channelsQuery.data?.channels?.[0] ?? null;
  const channelId = channel?.id;
  const messagesKey = queryKeys.communityMessages(slug, channelId);
  const canLoad = enabled && Boolean(channelId);

  const history = useInfiniteQuery({
    queryKey: messagesKey,
    queryFn: ({ pageParam }) =>
      api.getCommunityMessages(slug, channelId, { before: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined,
    getNextPageParam: olderPageParam,
    enabled: canLoad,
    staleTime: 10_000,
    retry: 1,
  });

  // Folds the newest page into the room: new messages, and edits, removals and reactions on them.
  const pullLatest = useCallback(async () => {
    try {
      const page = await api.getCommunityMessages(slug, channelId, { limit: PAGE_SIZE });
      queryClient.setQueryData(messagesKey, (data) => page.items.reduce(upsertMessage, data));
    } catch {
      // The next push or pull tries again.
    }
  }, [slug, channelId, messagesKey, queryClient]);

  // The first page just arrived, so the first pull waits a full interval; after that a hidden tab stays quiet.
  const polling = canLoad && history.isSuccess;
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") pullLatest();
    }, LATEST_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, pullLatest]);

  // Listens to the room, so a change by anyone shows up at once instead of on the next pull.
  const socket = useSharedSocket();
  useEffect(() => {
    if (!polling || !socket) return undefined;

    let pullTimer;
    const onActivity = (event) => {
      if (event?.channelId !== channelId) return;
      clearTimeout(pullTimer);
      pullTimer = setTimeout(pullLatest, PUSH_PULL_DELAY_MS);
    };
    // After a reconnect the room must be joined again, and anything missed meanwhile is pulled.
    const join = () => {
      socket.emit("community:join", { slug, channelId });
      pullLatest();
    };

    socket.on("community:activity", onActivity);
    socket.on("connect", join);
    if (socket.connected) socket.emit("community:join", { slug, channelId });

    return () => {
      clearTimeout(pullTimer);
      socket.off("community:activity", onActivity);
      socket.off("connect", join);
      if (socket.connected) socket.emit("community:leave", { channelId });
    };
  }, [polling, socket, slug, channelId, pullLatest]);

  const putMessage = useCallback(
    (message) => queryClient.setQueryData(messagesKey, (data) => upsertMessage(data, message)),
    [queryClient, messagesKey],
  );

  // Messages on their way out, kept apart from the room so a failure can be retried or dropped.
  const [pending, setPending] = useState([]);

  const sendNow = useCallback(
    async (entry) => {
      try {
        const message = await api.sendCommunityMessage(slug, channelId, {
          content: entry.content,
          replyToId: entry.replyTo?.id,
          clientMessageId: entry.clientId,
        });
        putMessage(message);
        setPending((list) => list.filter((item) => item.clientId !== entry.clientId));
        queryClient.invalidateQueries({ queryKey: queryKeys.communityChannels(slug) });
      } catch (error) {
        setPending((list) =>
          list.map((item) =>
            item.clientId === entry.clientId
              ? { ...item, status: "failed", error: error?.message || "Could not send this." }
              : item,
          ),
        );
      }
    },
    [slug, channelId, putMessage, queryClient],
  );

  const send = useCallback(
    (content, replyTo) => {
      const entry = {
        clientId: crypto.randomUUID(),
        content,
        replyTo: replyTo ?? null,
        status: "sending",
        error: null,
        createdAt: new Date().toISOString(),
      };
      setPending((list) => [...list, entry]);
      return sendNow(entry);
    },
    [sendNow],
  );

  const retry = useCallback(
    (clientId) => {
      const entry = pending.find((item) => item.clientId === clientId);
      if (!entry) return undefined;
      setPending((list) =>
        list.map((item) =>
          item.clientId === clientId ? { ...item, status: "sending", error: null } : item,
        ),
      );
      return sendNow(entry);
    },
    [pending, sendNow],
  );

  const discard = useCallback(
    (clientId) => setPending((list) => list.filter((item) => item.clientId !== clientId)),
    [],
  );

  const edit = useMutation({
    mutationFn: ({ messageId, content }) => api.editCommunityMessage(slug, messageId, content),
    onSuccess: putMessage,
  });

  const remove = useMutation({
    mutationFn: ({ messageId, reason }) => api.removeCommunityMessage(slug, messageId, reason),
    onSuccess: putMessage,
  });

  // One reaction per person: `choice` null takes it back. Shown at once, put back if the server refuses.
  const react = useMutation({
    mutationFn: ({ messageId, choice }) =>
      choice
        ? api.reactToCommunityMessage(slug, messageId, choice)
        : api.unreactToCommunityMessage(slug, messageId),
    onMutate: async ({ messageId, choice }) => {
      await queryClient.cancelQueries({ queryKey: messagesKey });
      const previous = queryClient.getQueryData(messagesKey);
      queryClient.setQueryData(messagesKey, (data) =>
        patchMessage(
          data,
          messageId,
          (message) => withOptimisticReaction([message], messageId, user?.id, choice)[0],
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) =>
      queryClient.setQueryData(messagesKey, context?.previous),
    // The server answers with the reactions alone, so that is all that gets replaced.
    onSuccess: ({ id, reactions }) =>
      queryClient.setQueryData(messagesKey, (data) =>
        patchMessage(data, id, (message) => ({ ...message, reactions })),
      ),
  });

  const markRead = useCallback(
    (messageId) => {
      if (!channelId) return;
      api
        .markCommunityRead(slug, channelId, messageId)
        .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.communityChannels(slug) }))
        .catch(() => {});
    },
    [slug, channelId, queryClient],
  );

  return {
    channel,
    canModerate: Boolean(channelsQuery.data?.canModerate),
    messages: messagesOf(history.data),
    pending,
    isLoading: channelsQuery.isLoading || (canLoad && history.isLoading),
    // 403 means the viewer has not joined this community, which is not a failure.
    needsToJoin: channelsQuery.error?.status === 403,
    error: channelsQuery.error?.status === 403 ? null : (channelsQuery.error ?? history.error),
    reload: () => {
      channelsQuery.refetch();
      history.refetch();
    },
    hasOlder: Boolean(history.hasNextPage),
    isLoadingOlder: history.isFetchingNextPage,
    loadOlder: () => history.fetchNextPage(),
    send,
    retry,
    discard,
    edit,
    remove,
    react,
    markRead,
  };
}
