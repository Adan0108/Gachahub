"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";
import type { FollowListKind } from "../../components/profile/FollowListDialog";

/** One person in a follower or following list. */
export interface FollowPerson {
  id: string;
  name?: string | null;
  username?: string | null;
  image?: string | null;
  isFollowing?: boolean;
  followsYou?: boolean;
}
type FollowPage = { items: FollowPerson[]; nextCursor?: string | null };

const PAGE_SIZE = 20;

/** The people who follow someone (`kind` "followers") or whom they follow ("following"), a page at a time. */
export function useFollowList(
  userId: string,
  kind: FollowListKind,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.followList(userId, kind),
    queryFn: ({ pageParam, signal }): Promise<FollowPage> =>
      (kind === "followers" ? api.getFollowers : api.getFollowing)(
        userId,
        { cursor: pageParam, limit: PAGE_SIZE },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && Boolean(userId),
    retry: 1,
    staleTime: 15_000,
  });

  return {
    people: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    retry: query.refetch,
    hasMore: Boolean(query.hasNextPage),
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
  };
}
