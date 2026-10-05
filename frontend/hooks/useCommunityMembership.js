"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queries, queryKeys } from "../lib/queries";

/** Uses session-scoped server state; legacy local membership storage is ignored. */
export function useCommunityMembership(slug, userId) {
  const router = useRouter();
  const client = useQueryClient();
  const status = useQuery(queries.gameJoinStatus(slug, userId));
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: ({ slug, joined }) => (joined ? api.leaveGame(slug) : api.joinGame(slug)),
    onSuccess: async (result, scope) => {
      // Use the captured mutation scope even if the account/page changed while waiting.
      client.setQueryData(queryKeys.gameJoinStatus(scope.slug, scope.userId), result);
      await Promise.all([
        client.invalidateQueries({
          queryKey: queryKeys.gameJoinStatus(scope.slug, scope.userId),
          exact: true,
        }),
        client.invalidateQueries({ queryKey: queryKeys.joinedGames(scope.userId), exact: true }),
        client.invalidateQueries({ queryKey: queryKeys.community(scope.slug), exact: true }),
        client.invalidateQueries({ queryKey: ["games"] }),
        client.invalidateQueries({ queryKey: ["home"] }),
        client.invalidateQueries({ queryKey: queryKeys.adminGames.all }),
        client.invalidateQueries({ queryKey: queryKeys.adminOverview.all }),
      ]);
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const sameScope = mutation.variables?.slug === slug && mutation.variables?.userId === userId;

  /** Redirects guests using the existing auth UX and guards synchronous repeat clicks. */
  const toggle = () => {
    if (!userId) {
      router.push("/login");
      return;
    }
    if (inFlight.current || !status.isSuccess || status.isFetching) return;
    inFlight.current = true;
    mutation.mutate({ slug, userId, joined: status.data.joined });
  };
  return {
    joined: Boolean(userId && status.data?.joined),
    isLoading: Boolean(userId) && status.isLoading,
    isPending: sameScope && mutation.isPending,
    isError: Boolean(userId) && (status.isError || (sameScope && mutation.isError)),
    error: status.error || (sameScope ? mutation.error : null),
    toggle,
    retry: () => {
      mutation.reset();
      return status.refetch();
    },
  };
}
