"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";
import { useCurrentUser } from "../useCurrentUser";

/** Follows or unfollows one person, shown at once everywhere they appear: their profile, and every follower or following list. */
export function useFollow(userId) {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  const patchEverywhere = (follow) => {
    queryClient.setQueryData(queryKeys.userProfile(userId), (profile) =>
      profile && !profile.isPrivate
        ? {
            ...profile,
            isFollowing: follow,
            counts: {
              ...profile.counts,
              followers: Math.max(0, profile.counts.followers + (follow ? 1 : -1)),
            },
          }
        : profile,
    );
    // Every cached page of every list, since the same person can be in several.
    queryClient.setQueriesData({ queryKey: ["users"] }, (data) =>
      data?.pages
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((row) =>
                row.id === userId ? { ...row, isFollowing: follow } : row,
              ),
            })),
          }
        : data,
    );
  };

  return useMutation({
    mutationFn: ({ follow }) => (follow ? api.followUser(userId) : api.unfollowUser(userId)),
    onMutate: ({ follow }) => patchEverywhere(follow),
    onSettled: () => {
      // The truth from the server, including your own "following" count.
      queryClient.invalidateQueries({ queryKey: queryKeys.userProfile(userId) });
      if (user?.id) queryClient.invalidateQueries({ queryKey: queryKeys.userProfile(user.id) });
      queryClient.invalidateQueries({
        queryKey: ["users"],
        predicate: (query) => query.queryKey[2] !== "profile" && query.queryKey[2] !== "posts",
      });
    },
  });
}
