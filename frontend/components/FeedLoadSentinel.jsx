"use client";

import { useEffect, useRef } from "react";
import { QueryNotice } from "./QueryNotice";

/** Automatically continues any cursor feed as its bottom approaches the viewport. */
export function FeedLoadSentinel({ feed }) {
  const sentinel = useRef(null);
  const { canLoadMore, isFetching, nextCursor, scopeKey, loadMore } = feed;
  useEffect(() => {
    if (
      !canLoadMore ||
      isFetching ||
      !sentinel.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "300px", threshold: 0 },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [canLoadMore, isFetching, nextCursor, scopeKey, loadMore]);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      <QueryNotice isLoading={feed.isFetchingNextPage} loadingText="Loading more posts..." />
      <QueryNotice
        isError={feed.recoveryPaused}
        errorText="The feed could not continue. Please restart it."
        onRetry={feed.restart}
      />
    </>
  );
}
