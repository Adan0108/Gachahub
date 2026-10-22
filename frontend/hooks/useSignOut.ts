"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clearModerationCache } from "../lib/moderation";
import { api } from "../lib/api";
import { CHAT_BACKUP_QUERY_ROOT } from "../lib/backup/backupQueryKeys";
import "../lib/backup/backupSessionCleanup";
import { queryKeys } from "../lib/queries";
import { runSessionCleanups } from "../lib/sessionCleanup";

export function useSignOut({ onSignedOut }: { onSignedOut?: () => void } = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.signOut,
    // Every step that must happen on sign-out lives here, so a new one can't land in one caller only.
    onSuccess: async () => {
      await clearModerationCache(queryClient);
      await runSessionCleanups();
      queryClient.setQueryData(queryKeys.currentUser, null);
      queryClient.removeQueries({ queryKey: CHAT_BACKUP_QUERY_ROOT });
      onSignedOut?.();
      router.push("/");
    },
  });
}
