"use client";

import { useRef } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

export function useCursorFeed(options) {
  const client = useQueryClient();
  const query = useInfiniteQuery(options);
  const inFlight = useRef(false);
  const restart = () => client.resetQueries({ queryKey: options.queryKey, exact: true });
  const loadMore = async () => {
    if (inFlight.current || query.isFetching || !query.hasNextPage) return;
    inFlight.current = true;
    try {
      await query.fetchNextPage({ cancelRefetch: false, throwOnError: true });
    } catch (error) {
      // Snapshot services use 410 for expiry and 400 for invalid/filter-bound cursors.
      // Reset replaces all old pages and requests once without the rejected cursor.
      if ([400, 410].includes(error.status)) await restart();
    } finally {
      inFlight.current = false;
    }
  };
  return { ...query, items: query.data?.pages.flatMap((page) => page.items), loadMore, restart };
}
