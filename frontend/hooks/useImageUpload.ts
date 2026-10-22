"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useLocalFileUrl } from "./useLocalFileUrl";

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Mirrors the policy MediaService enforces at confirm time (see backend .env.example for the
// Cloudinary preset limits) - this is only for instant feedback.
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

export function imageFileProblem(file: File) {
  // With no type from the browser (Windows gives none for many files) the extension decides; no extension either is left to the backend.
  const extension = /\.([A-Za-z0-9]+)$/.exec(file.name ?? "")?.[1]?.toLowerCase();
  const isImage = file.type
    ? IMAGE_ACCEPT.split(",").includes(file.type)
    : !extension || IMAGE_EXTENSIONS.includes(extension);
  if (!isImage) {
    return "Use a JPG, PNG, WebP or GIF image";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image must be 10 MB or smaller";
  }
  return null;
}

function assertAcceptableImage(file: File) {
  const problem = imageFileProblem(file);
  if (problem) throw new Error(problem);
}

/**
 * Pick -> upload -> save for a single-image slot (game icon, avatar, ...).
 * `save(mediaUploadId)` persists the confirmed upload and `getUrl(result)` reads the saved url back.
 */
type SavedImageResult = Record<string, unknown>;
type ImageUploadOptions = {
  purpose: string;
  currentUrl?: string | null;
  save: (mediaUploadId: string) => Promise<SavedImageResult>;
  getUrl: (result: SavedImageResult) => string | null | undefined;
  onSaved?: (result: SavedImageResult) => void;
};

export function useImageUpload({ purpose, currentUrl, save, getUrl, onSaved }: ImageUploadOptions) {
  const [file, setFile] = useState<File | null>(null);
  const [resolvedOverride, setResolvedOverride] = useState<string | null | undefined>(null);
  const [lastSeenCurrentUrl, setLastSeenCurrentUrl] = useState(currentUrl);

  // Render-time "adjust state when a prop changes" (not an effect): the moment the parent hands us
  // a genuinely different currentUrl (a refetch, or someone else's change), drop our own override
  // instead of shadowing the parent's data forever after our first upload.
  if (currentUrl !== lastSeenCurrentUrl) {
    setLastSeenCurrentUrl(currentUrl);
    setResolvedOverride(null);
  }

  const mutation = useMutation({
    mutationFn: async (selected: File) => {
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

  const start = (selected: File | null | undefined) => {
    if (!selected) return;
    setFile(selected);
    mutation.mutate(selected);
  };

  // For an <input type="file" onChange>; resets the input so picking the same file twice still fires.
  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = "";
    start(selected);
  };

  // For files dropped onto the slot: the first one is used.
  const pickDropped = (files: FileList | File[] | null | undefined) => start(files?.[0]);

  return {
    pickFile,
    pickDropped,
    displayUrl: previewUrl || resolvedOverride || currentUrl,
    isPending: mutation.isPending,
    error: mutation.isError ? mutation.error.message || "Upload failed" : null,
  };
}
