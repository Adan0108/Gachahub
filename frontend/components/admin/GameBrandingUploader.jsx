"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FiImage, FiLoader } from "react-icons/fi";
import { useLocalFileUrl } from "../../hooks/useLocalFileUrl";
import { api } from "../../lib/api";

// Single source of truth for which game field/column a branding purpose maps to.
const BRANDING_FIELDS = {
  GAME_ICON: { dtoField: "iconMediaUploadId", urlField: "iconUrl" },
  GAME_BANNER: { dtoField: "bannerMediaUploadId", urlField: "bannerUrl" },
};

// One image picker for a game's icon or banner - used by both the admin Communities form and the moderator's own page.
export function GameBrandingUploader({ gameSlug, purpose, label, currentUrl, onUpdated }) {
  const [file, setFile] = useState(null);
  const [resolvedOverride, setResolvedOverride] = useState(null);
  const [lastSeenCurrentUrl, setLastSeenCurrentUrl] = useState(currentUrl);
  const inputRef = useRef(null);
  const fields = BRANDING_FIELDS[purpose];

  // Render-time "adjust state when a prop changes" (not an effect): the moment the parent hands us
  // a genuinely different currentUrl (a refetch, or someone else's change), drop our own override
  // instead of shadowing the parent's data forever after our first upload.
  if (currentUrl !== lastSeenCurrentUrl) {
    setLastSeenCurrentUrl(currentUrl);
    setResolvedOverride(null);
  }

  const mutation = useMutation({
    mutationFn: async (selected) => {
      const uploaded = await api.uploadSingleImage(selected, purpose);
      return api.updateGameBranding(gameSlug, { [fields.dtoField]: uploaded.mediaUploadId });
    },
    onSuccess: (game) => {
      setResolvedOverride(game[fields.urlField]);
      setFile(null);
      onUpdated?.(game);
    },
  });

  // Shown only while the upload is in flight - once it settles (success or error) this
  // clears, so a failed branding PATCH never leaves a not-actually-saved image on screen.
  const previewUrl = useLocalFileUrl(file, Boolean(file) && mutation.isPending);

  const pick = (event) => {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setFile(selected);
    mutation.mutate(selected);
  };

  const displayUrl = previewUrl || resolvedOverride || currentUrl;

  return (
    <div className="branding-uploader">
      <span className="branding-uploader-preview">
        {displayUrl ? <img alt="" src={displayUrl} /> : <FiImage aria-hidden="true" />}
        {mutation.isPending ? (
          <FiLoader aria-hidden="true" className="branding-uploader-spinner" />
        ) : null}
      </span>
      <div className="branding-uploader-body">
        <span>{label}</span>
        <button
          className="admin-button admin-button-secondary"
          disabled={mutation.isPending}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          {mutation.isPending ? "Uploading..." : displayUrl ? "Replace" : "Upload"}
        </button>
        {mutation.isError ? (
          <p className="admin-form-error" role="alert">
            {mutation.error.message || "Upload failed"}
          </p>
        ) : null}
      </div>
      <input
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={pick}
        ref={inputRef}
        type="file"
      />
    </div>
  );
}
