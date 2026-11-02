"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";
import type { CosmeticSlot } from "../../lib/cosmetics";
import type { AvatarChange } from "../../components/profile/AvatarEditor";

/** Everything the Edit profile dialog saves at once; a field left out is not changed. */
export interface ProfileChanges {
  name?: string;
  bio?: string;
  avatar?: AvatarChange;
  /** A banner design id, or null for the default banner. */
  bannerPresetId?: string | null;
  /** Equipped cosmetic slot changes: slot -> itemId (or null to unequip). */
  equippedChanges?: Partial<Record<CosmeticSlot, string | null>>;
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
    mutationFn: async ({ name, bio, avatar, bannerPresetId, equippedChanges }: ProfileChanges) => {
      const saved: SavedUser[] = [];
      if (avatar?.kind === "upload") saved.push(await api.updateAvatar(avatar.mediaUploadId));
      if (avatar?.kind === "remove") saved.push(await api.removeAvatar());
      if (bannerPresetId !== undefined) {
        saved.push(await (bannerPresetId ? api.updateBanner(bannerPresetId) : api.removeBanner()));
      }
      if (name !== undefined || bio !== undefined) saved.push(await api.updateProfile({ name, bio }));
      let equippedUpdated = false;
      if (equippedChanges) {
        const entries = Object.entries(equippedChanges) as [CosmeticSlot, string | null | undefined][];
        for (const [slot, itemId] of entries) {
          if (itemId !== undefined) {
            await api.equipCosmetic(slot, itemId);
            equippedUpdated = true;
          }
        }
      }
      return { saved, equippedUpdated };
    },
    onSuccess: ({ saved, equippedUpdated }) => {
      saved.forEach(cacheUser);
      const current = queryClient.getQueryData<{ id?: string }>(queryKeys.currentUser);
      const id = saved.at(-1)?.id ?? current?.id;
      if (equippedUpdated) {
        queryClient.invalidateQueries({ queryKey: queryKeys.myCosmetics });
        queryClient.invalidateQueries({ queryKey: queryKeys.currentUser });
      }
      if (id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.userProfile(id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.userCard(id) });
      }
    },
  });
}
