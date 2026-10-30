"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { withOptimisticReaction, type ReactionChoice } from "../../lib/chat/chatReactions";
import {
  COMMUNITY_SEND_LIMIT,
  hasMessage,
  messagesOf,
  olderPageParam,
  patchMessage,
  upsertMessage,
  type CommunityMessage,
  type CommunityPagesData,
} from "../../lib/community/communityChat";
import { queries, queryKeys } from "../../lib/queries";
import { useSharedSocket } from "../../lib/socket/sharedSocket";
import { useSendCooldown } from "../chat/useSendCooldown";
import { useCurrentUser } from "../useCurrentUser";

const PAGE_SIZE = 50;
// The server says when a room changed; this slower pull only catches whatever a push missed.
const LATEST_POLL_MS = 60_000;
// A burst of changes (several people typing at once) is one pull.
const PUSH_PULL_DELAY_MS = 150;
// More changed messages than this are not fetched one by one; the loaded pages are reloaded instead.
const MAX_MESSAGE_REFRESHES = 10;

type UploadedImage = { file: File; mediaUploadId: string };
export type PendingCommunityMessage = {
  clientId: string;
  content: string;
  files: File[];
  uploaded: UploadedImage[];
  replyTo: CommunityMessage | null;
  status: "sending" | "failed";
  error: string | null;
  createdAt: string;
};
type ApiError = Error & { status?: number; retryAfterSeconds?: number };

/**
 * One community's chat room: its messages (newest page first, older ones on demand), sending with
 * a visible "sending / failed" state, and edit, remove and reactions. Everything stays in the
 * React Query cache so the room opens instantly the second time.
 */
export function useCommunityChat(slug: string, { enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const channelsQuery = useQuery({ ...queries.communityChannels(slug), enabled });
  // One room per community for now; the API already lists several.
  const channel = channelsQuery.data?.channels?.[0] ?? null;
  const channelId = channel?.id;
  const canModerate = Boolean(channelsQuery.data?.canModerate);
  const { tryConsume, noteRateLimited, isCoolingDown, secondsLeft } = useSendCooldown(
    COMMUNITY_SEND_LIMIT,
    channelId ?? "",
  );
  // Memoized: a new array every render would restart every effect that depends on it.
  const messagesKey = useMemo(() => queryKeys.communityMessages(slug, channelId), [slug, channelId]);
  const canLoad = enabled && Boolean(channelId);

  const history = useInfiniteQuery({
    queryKey: messagesKey,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.getCommunityMessages(slug, channelId, { before: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined,
    getNextPageParam: olderPageParam,
    enabled: canLoad,
    staleTime: 10_000,
    retry: 1,
  });

  const putMessage = useCallback(
    (message: CommunityMessage) =>
      queryClient.setQueryData<CommunityPagesData>(messagesKey, (data) => upsertMessage(data, message)),
    [queryClient, messagesKey],
  );

  // Reloads every loaded page in order, which also rebuilds the chain of pages and catches changes to old messages.
  const reconcileAll = useCallback(
    () => queryClient.refetchQueries({ queryKey: messagesKey }),
    [queryClient, messagesKey],
  );

  // Folds the newest page into the room: new messages, and edits, removals and reactions on them.
  const pullLatest = useCallback(async () => {
    try {
      const page = await api.getCommunityMessages(slug, channelId, { limit: PAGE_SIZE });
      const oldest = page.items[0];
      // A page that does not reach the loaded messages leaves a gap nobody can scroll to.
      if (
        page.hasMore &&
        oldest &&
        !hasMessage(queryClient.getQueryData<CommunityPagesData>(messagesKey), oldest.id)
      ) {
        await reconcileAll();
        return;
      }
      queryClient.setQueryData<CommunityPagesData>(messagesKey, (data) =>
        (page.items as CommunityMessage[]).reduce(upsertMessage, data),
      );
    } catch {
      // The next push or pull tries again.
    }
  }, [slug, channelId, messagesKey, queryClient, reconcileAll]);

  // Fetches the one message somebody changed, wherever it sits in the loaded pages.
  const refreshMessage = useCallback(
    async (messageId: string) => {
      try {
        putMessage(await api.getCommunityMessage(slug, messageId));
      } catch {
        // The next push or pull tries again.
      }
    },
    [slug, putMessage],
  );

  const socket = useSharedSocket();

  // The first page just arrived, so the first pull waits a full interval; after that a hidden tab stays quiet.
  const polling = canLoad && history.isSuccess;
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Without a live connection nothing says which old message changed, so every loaded page is checked.
      if (socket?.connected) pullLatest();
      else reconcileAll();
    }, LATEST_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, socket, pullLatest, reconcileAll]);

  // Listens to the room, so a change by anyone shows up at once instead of on the next pull.
  useEffect(() => {
    if (!polling || !socket) return undefined;

    let pullTimer: ReturnType<typeof setTimeout> | undefined;
    let changedIds = new Set<string>();
    let unlabelled = false;
    const flush = () => {
      const cached = queryClient.getQueryData<CommunityPagesData>(messagesKey);
      const ids = [...changedIds];
      const known = ids.filter((id) => hasMessage(cached, id));
      const hasNew = unlabelled || known.length < ids.length;
      changedIds = new Set();
      unlabelled = false;

      if (hasNew) pullLatest();
      if (known.length > MAX_MESSAGE_REFRESHES) reconcileAll();
      else known.forEach(refreshMessage);
    };
    const onActivity = (event: { channelId?: string; messageId?: string } | undefined) => {
      if (event?.channelId !== channelId) return;
      if (event?.messageId) changedIds.add(event.messageId);
      else unlabelled = true;
      clearTimeout(pullTimer);
      pullTimer = setTimeout(flush, PUSH_PULL_DELAY_MS);
    };
    // After a reconnect the room must be joined again, and anything missed meanwhile is reloaded.
    const join = () => {
      socket.emit("community:join", { slug, channelId });
      reconcileAll();
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
  }, [
    polling,
    socket,
    slug,
    channelId,
    messagesKey,
    queryClient,
    pullLatest,
    reconcileAll,
    refreshMessage,
  ]);

  // Messages on their way out, kept apart from the room so a failure can be retried or dropped.
  const [pending, setPending] = useState<PendingCommunityMessage[]>([]);

  // Uploads the pictures that are not up yet; the ones that made it are kept on the entry, so a retry only sends the rest.
  const uploadImages = useCallback(async (entry: PendingCommunityMessage): Promise<string[]> => {
    const files = entry.files ?? [];
    const uploaded = [...(entry.uploaded ?? [])];
    const todo = files.filter((file) => !uploaded.some((item) => item.file === file));
    const results = await Promise.allSettled(
      todo.map((file) => api.uploadSingleImage(file, "COMMUNITY")),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        const file = todo[index];
        if (file) uploaded.push({ file, mediaUploadId: result.value.mediaUploadId });
      }
    });
    setPending((list) =>
      list.map((item) => (item.clientId === entry.clientId ? { ...item, uploaded } : item)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected")
      throw new Error(failure.reason?.message || "Could not upload an image.");
    return files.map((file) => uploaded.find((item) => item.file === file)?.mediaUploadId ?? "");
  }, []);

  const sendNow = useCallback(
    async (entry: PendingCommunityMessage) => {
      try {
        const mediaUploadIds = await uploadImages(entry);
        const message = await api.sendCommunityMessage(slug, channelId, {
          content: entry.content,
          replyToId: entry.replyTo?.id,
          clientMessageId: entry.clientId,
          ...(mediaUploadIds.length ? { mediaUploadIds } : {}),
        });
        putMessage(message);
        setPending((list) => list.filter((item) => item.clientId !== entry.clientId));
        queryClient.invalidateQueries({ queryKey: queryKeys.communityChannels(slug) });
      } catch (error) {
        const { status, retryAfterSeconds } = (error ?? {}) as ApiError;
        if (status === 429) noteRateLimited(retryAfterSeconds, channelId ?? "");
        setPending((list) =>
          list.map((item) =>
            item.clientId === entry.clientId
              ? {
                  ...item,
                  status: "failed" as const,
                  error: (error as Error | undefined)?.message || "Could not send this.",
                }
              : item,
          ),
        );
      }
    },
    [slug, channelId, putMessage, queryClient, uploadImages, noteRateLimited],
  );

  const send = useCallback(
    (content: string, replyTo?: CommunityMessage | null, files: File[] = []) => {
      if (!canModerate && !tryConsume()) return Promise.resolve();
      const entry: PendingCommunityMessage = {
        clientId: crypto.randomUUID(),
        content,
        files,
        uploaded: [],
        replyTo: replyTo ?? null,
        status: "sending",
        error: null,
        createdAt: new Date().toISOString(),
      };
      setPending((list) => [...list, entry]);
      return sendNow(entry);
    },
    [sendNow, canModerate, tryConsume],
  );

  const retry = useCallback(
    (clientId: string) => {
      const entry = pending.find((item) => item.clientId === clientId);
      if (!entry || (!canModerate && !tryConsume())) return undefined;
      setPending((list) =>
        list.map((item) =>
          item.clientId === clientId ? { ...item, status: "sending" as const, error: null } : item,
        ),
      );
      return sendNow(entry);
    },
    [pending, sendNow, canModerate, tryConsume],
  );

  const discard = useCallback(
    (clientId: string) => setPending((list) => list.filter((item) => item.clientId !== clientId)),
    [],
  );

  const edit = useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      api.editCommunityMessage(slug, messageId, content),
    onSuccess: putMessage,
  });

  const remove = useMutation({
    mutationFn: ({ messageId, reason }: { messageId: string; reason?: string }) =>
      api.removeCommunityMessage(slug, messageId, reason),
    onSuccess: putMessage,
  });

  // One reaction per person: `choice` null takes it back. Shown at once, put back if the server refuses.
  const react = useMutation({
    mutationFn: ({ messageId, choice }: { messageId: string; choice: ReactionChoice | null }) =>
      choice
        ? api.reactToCommunityMessage(slug, messageId, choice)
        : api.unreactToCommunityMessage(slug, messageId),
    onMutate: async ({ messageId, choice }) => {
      await queryClient.cancelQueries({ queryKey: messagesKey });
      const previous = queryClient.getQueryData<CommunityPagesData>(messagesKey);
      queryClient.setQueryData<CommunityPagesData>(messagesKey, (data) =>
        patchMessage(
          data,
          messageId,
          (message) =>
            withOptimisticReaction([message], messageId, user?.id ?? "", choice)[0] ?? message,
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) =>
      queryClient.setQueryData(messagesKey, context?.previous),
    // The server answers with the reactions alone, so that is all that gets replaced.
    onSuccess: ({ id, reactions }: { id: string; reactions: CommunityMessage["reactions"] }) =>
      queryClient.setQueryData<CommunityPagesData>(messagesKey, (data) =>
        patchMessage(data, id, (message) => ({ ...message, reactions })),
      ),
  });

  const markRead = useCallback(
    (messageId: string) => {
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
    canModerate,
    sendCooldownSeconds: !canModerate && isCoolingDown ? secondsLeft : 0,
    messages: messagesOf(history.data),
    pending,
    isLoading: channelsQuery.isLoading || (canLoad && history.isLoading),
    // 403 means the viewer has not joined this community, which is not a failure.
    needsToJoin: (channelsQuery.error as ApiError | null)?.status === 403,
    error:
      (channelsQuery.error as ApiError | null)?.status === 403
        ? null
        : (channelsQuery.error ?? history.error),
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
