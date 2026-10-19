"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";

/** Saves your display name and bio; the answer is your account as it now is, and goes straight into the cache. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (changes) => api.updateProfile(changes),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.currentUser, (previous) => ({ ...previous, ...updated }));
      queryClient.invalidateQueries({ queryKey: queryKeys.userProfile(updated.id) });
    },
  });
}
