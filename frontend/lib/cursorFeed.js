export function cursorFeedOptions(queryKey, fetchPage, enabled = true) {
  return {
    queryKey,
    queryFn: ({ pageParam, signal }) => fetchPage({ cursor: pageParam, signal }),
    initialPageParam: undefined,
    getNextPageParam: (page) =>
      page.meta.hasMore && page.meta.nextCursor ? page.meta.nextCursor : undefined,
    enabled,
    retry: (count, error) => ![400, 401, 410].includes(error.status) && count < 1,
    gcTime: 0,
    staleTime: 30_000,
  };
}
