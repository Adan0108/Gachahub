"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queries";

/** Avatar + banner writes; each returns the updated user, which goes straight into the current-user cache (a refetch could race a stale snapshot). */
export function useProfileImages() {
  const queryClient = useQueryClient();
  const cacheUser = (updated) =>
    queryClient.setQueryData(queryKeys.currentUser, (previous) => ({ ...previous, ...updated }));

  return {
    cacheUser,
    removeAvatar: useMutation({ mutationFn: api.removeAvatar, onSuccess: cacheUser }),
    saveBanner: useMutation({ mutationFn: api.updateBanner, onSuccess: cacheUser }),
    removeBanner: useMutation({ mutationFn: api.removeBanner, onSuccess: cacheUser }),
  };
}
