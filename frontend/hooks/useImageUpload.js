"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useLocalFileUrl } from "./useLocalFileUrl";

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Mirrors the policy MediaService enforces at confirm time (see backend .env.example for the
// Cloudinary preset limits) - this is only for instant feedback.
function assertAcceptableImage(file) {
  // An empty type means the browser couldn't infer one, not that the file is wrong; the
  // backend decides by the real format after upload.
  if (file.type && !IMAGE_ACCEPT.split(",").includes(file.type)) {
    throw new Error("Use a JPG, PNG, WebP or GIF image");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image must be 10 MB or smaller");
  }
}

/**
 * Pick -> upload -> save for a single-image slot (game icon, avatar, ...).
 * `save(mediaUploadId)` persists the confirmed upload and `getUrl(result)` reads the saved url back.
 */
export function useImageUpload({ purpose, currentUrl, save, getUrl, onSaved }) {
  const [file, setFile] = useState(null);
  const [resolvedOverride, setResolvedOverride] = useState(null);
  const [lastSeenCurrentUrl, setLastSeenCurrentUrl] = useState(currentUrl);

  // Render-time "adjust state when a prop changes" (not an effect): the moment the parent hands us
  // a genuinely different currentUrl (a refetch, or someone else's change), drop our own override
  // instead of shadowing the parent's data forever after our first upload.
  if (currentUrl !== lastSeenCurrentUrl) {
    setLastSeenCurrentUrl(currentUrl);
    setResolvedOverride(null);
  }

  const mutation = useMutation({
    mutationFn: async (selected) => {
      assertAcceptableImage(selected);
      const uploaded = await api.uploadSingleImage(selected, purpose);
      return save(uploaded.mediaUploadId);
    },
    onSuccess: (result) => {
      setResolvedOverride(getUrl(result));
      setFile(null);
      onSaved?.(result);
    },
  });

  // Shown only while the upload is in flight - once it settles (success or error) this
  // clears, so a failed save never leaves a not-actually-saved image on screen.
  const previewUrl = useLocalFileUrl(file, Boolean(file) && mutation.isPending);

  // For an <input type="file" onChange>; resets the input so picking the same file twice still fires.
  const pickFile = (event) => {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setFile(selected);
    mutation.mutate(selected);
  };

  return {
    pickFile,
    displayUrl: previewUrl || resolvedOverride || currentUrl,
    isPending: mutation.isPending,
    error: mutation.isError ? mutation.error.message || "Upload failed" : null,
  };
}
