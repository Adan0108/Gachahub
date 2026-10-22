"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { isPlatformModerator, MODERATION_ROOT } from "../../lib/moderation";

export function ModerationNavigation({
  user,
  onNavigate,
}: {
  user?: { id?: string; role?: string | null; status?: string | null } | null;
  onNavigate?: () => void;
}) {
  const privileged = isPlatformModerator(user);
  const assignments = useQuery({
    queryKey: [...MODERATION_ROOT, user?.id, "assignments"],
    queryFn: ({ signal }) => api.listModeratedGames({ signal }),
    enabled: Boolean(user?.status === "ACTIVE" && !privileged),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return (
    <>
      {privileged && (
        <Link href="/moderation/cases" onClick={onNavigate} role="menuitem">
          Moderation cases
        </Link>
      )}
      {user?.status === "ACTIVE" && user.role === "ADMIN" && (
        <Link href="/admin" onClick={onNavigate} role="menuitem">
          Admin console
        </Link>
      )}
      {user?.status === "ACTIVE" && !privileged && !assignments.isError && assignments.data?.length > 0 && (
        <Link href="/moderator" onClick={onNavigate} role="menuitem">
          My moderated games
        </Link>
      )}
    </>
  );
}
