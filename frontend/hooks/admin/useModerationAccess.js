"use client";

import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "../useCurrentUser";
import { api } from "../../lib/api";
import { isPlatformModerator, MODERATION_ROOT } from "../../lib/moderation";

export function useModerationAccess(gameSlug = "") {
  const session = useCurrentUser();
  const privileged = isPlatformModerator(session.user);
  const active = session.user?.status === "ACTIVE";
  const assignments = useQuery({
    queryKey: [...MODERATION_ROOT, session.user?.id, "assignments"],
    queryFn: ({ signal }) => api.listModeratedGames({ signal }),
    enabled: Boolean(gameSlug && active && !privileged),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const allowed = Boolean(
    active &&
    (privileged ||
      (gameSlug &&
        !assignments.isError &&
        assignments.data?.some((game) => game.slug === gameSlug))),
  );
  return {
    ...session,
    allowed,
    privileged,
    isLoading:
      session.isLoading || Boolean(gameSlug && active && !privileged && assignments.isPending),
    error: session.isError ? new Error("Could not verify your session.") : assignments.error,
    retry: () => {
      void session.refetch();
      if (gameSlug && !privileged) void assignments.refetch();
    },
  };
}
