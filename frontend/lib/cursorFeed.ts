import type { QueryKey } from "@tanstack/react-query";

type CursorPage = {
  items: unknown[];
  meta: { hasMore: boolean; nextCursor?: string | null };
};
type FetchPage<Page extends CursorPage> = (options: {
  cursor: string | undefined;
  signal: AbortSignal;
}) => Promise<Page>;
type ApiError = { status?: number };

export function cursorFeedOptions<Page extends CursorPage>(
  queryKey: QueryKey,
  fetchPage: FetchPage<Page>,
  enabled = true,
) {
  return {
    queryKey,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      fetchPage({ cursor: pageParam, signal }),
    initialPageParam: undefined,
    getNextPageParam: (page: Page) =>
      page.meta.hasMore && page.meta.nextCursor ? page.meta.nextCursor : undefined,
    enabled,
    retry: (count: number, error: ApiError) =>
      ![400, 401, 410].includes(error.status ?? 0) && count < 1,
    gcTime: 0,
    staleTime: 30_000,
  };
}
