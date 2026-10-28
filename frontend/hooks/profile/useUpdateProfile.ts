"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";
import type { AvatarChange } from "../../components/profile/AvatarEditor";

/** Everything the Edit profile dialog saves at once; a field left out is not changed. */
export interface ProfileChanges {
  name?: string;
  bio?: string;
  avatar?: AvatarChange;
  /** A banner design id, or null for the default banner. */
  bannerPresetId?: string | null;
}

type SavedUser = { id: string } & Record<string, unknown>;

/** Saves the dialog's changes in one go; each answer is your account as it now is, and goes straight into the cache. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const cacheUser = (updated: SavedUser) =>
    queryClient.setQueryData(queryKeys.currentUser, (previous: object | undefined) => ({
      ...previous,
      ...updated,
    }));

  return useMutation({
    mutationFn: async ({ name, bio, avatar, bannerPresetId }: ProfileChanges) => {
      const saved: SavedUser[] = [];
      if (avatar?.kind === "upload") saved.push(await api.updateAvatar(avatar.mediaUploadId));
      if (avatar?.kind === "remove") saved.push(await api.removeAvatar());
      if (bannerPresetId !== undefined) {
        saved.push(await (bannerPresetId ? api.updateBanner(bannerPresetId) : api.removeBanner()));
      }
      if (name !== undefined || bio !== undefined) saved.push(await api.updateProfile({ name, bio }));
      return saved;
    },
    onSuccess: (saved) => {
      saved.forEach(cacheUser);
      const id = saved.at(-1)?.id;
      if (id) queryClient.invalidateQueries({ queryKey: queryKeys.userProfile(id) });
    },
  });
}
