"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "../useRequireAuth";
import { queries } from "../../lib/queries";

// Gate for the standalone /moderator page - redirects to / once it's certain this user moderates no games.
export function useRequireModerator() {
  const router = useRouter();
  const session = useRequireAuth();
  const moderated = useQuery({
    ...queries.moderatedGames(),
    enabled: session.isAuthenticated,
  });
  const games = moderated.data || [];
  const hasAccess = games.length > 0;

  useEffect(() => {
    if (session.isLoading || !session.isAuthenticated) return;
    if (moderated.isLoading || moderated.isError) return;
    if (!hasAccess) router.replace("/");
  }, [
    hasAccess,
    moderated.isError,
    moderated.isLoading,
    router,
    session.isAuthenticated,
    session.isLoading,
  ]);

  return {
    user: session.user,
    isAuthenticated: session.isAuthenticated,
    isLoading: session.isLoading || moderated.isLoading,
    hasAccess,
    games,
    gamesError: session.isError || moderated.isError,
    refetchGames: moderated.refetch,
  };
}
