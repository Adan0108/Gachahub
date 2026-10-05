"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

/** Owns opaque cursor continuation, scope resets and bounded snapshot recovery. */
export function useCursorFeed(options) {
  const client = useQueryClient();
  const query = useInfiniteQuery(options);
  const scopeKey = JSON.stringify(options.queryKey);
  const activeScope = useRef(scopeKey);
  const inFlight = useRef(null);
  const [rejected, setRejected] = useState(null);

  const lastPage = query.data?.pages.at(-1);
  const nextCursor = lastPage?.meta.hasMore ? lastPage.meta.nextCursor : null;
  const recoveryPaused = rejected?.scopeKey === scopeKey && rejected.cursor === nextCursor;
  const canLoadMore = Boolean(
    options.enabled !== false &&
    query.hasNextPage &&
    nextCursor &&
    !query.isError &&
    !recoveryPaused,
  );

  const currentGuard = useRef({ scopeKey, nextCursor, canLoadMore, isFetching: query.isFetching });
  useLayoutEffect(() => {
    activeScope.current = scopeKey;
    currentGuard.current = { scopeKey, nextCursor, canLoadMore, isFetching: query.isFetching };
  }, [scopeKey, nextCursor, canLoadMore, query.isFetching]);

  /** Explicit retry clears recovery protection and replaces all accumulated pages. */
  const restart = () => {
    setRejected(null);
    return client.resetQueries({ queryKey: options.queryKey, exact: true });
  };

  /** Guards observer callbacks and forwards the server cursor without modifying it. */
  const loadMore = async () => {
    if (
      activeScope.current !== scopeKey ||
      inFlight.current === scopeKey ||
      currentGuard.current.nextCursor !== nextCursor ||
      currentGuard.current.isFetching ||
      !currentGuard.current.canLoadMore
    )
      return;
    inFlight.current = scopeKey;
    try {
      await query.fetchNextPage({ cancelRefetch: false, throwOnError: true });
    } catch (error) {
      if (activeScope.current === scopeKey && [400, 410].includes(error.status)) {
        // Restart once. If the first response repeats the rejected cursor, require
        // an explicit retry instead of entering an automatic observer/error loop.
        setRejected({ scopeKey, cursor: nextCursor });
        await client.resetQueries({ queryKey: options.queryKey, exact: true });
      }
    } finally {
      if (inFlight.current === scopeKey) inFlight.current = null;
    }
  };
  return {
    ...query,
    scopeKey,
    nextCursor,
    canLoadMore,
    recoveryPaused,
    items: query.data?.pages.flatMap((page) => page.items),
    loadMore,
    restart,
  };
}
