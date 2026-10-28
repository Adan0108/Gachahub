"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AvatarFace } from "../AvatarFace";
import { IMAGE_ACCEPT, imageFileProblem } from "../../hooks/useImageUpload";
import { useLocalFileUrl } from "../../hooks/useLocalFileUrl";
import { api } from "../../lib/api";

/** What Save should do with the picture: leave it, use an uploaded new one, or take it away. */
export type AvatarChange =
  | { kind: "keep" }
  | { kind: "upload"; mediaUploadId: string; file: File }
  | { kind: "remove" };

/**
 * Pick, replace or remove the profile picture. A picked file is uploaded at once so Save is quick,
 * but nothing changes on the profile until the dialog's Save; `onUploadingChange` holds Save back
 * while the upload runs.
 */
export function AvatarEditor({
  user,
  change,
  onChange,
  onUploadingChange,
}: {
  user: { image?: string | null; name?: string | null };
  change: AvatarChange;
  onChange: (change: AvatarChange) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const problem = imageFileProblem(file);
      if (problem) throw new Error(problem);
      return (await api.uploadSingleImage(file, "AVATAR")).mediaUploadId;
    },
    onMutate: (file) => {
      setUploadingFile(file);
      onUploadingChange?.(true);
    },
    onSuccess: (mediaUploadId, file) => onChange({ kind: "upload", mediaUploadId, file }),
    onSettled: () => {
      setUploadingFile(null);
      onUploadingChange?.(false);
    },
  });

  const shownFile = uploadingFile ?? (change.kind === "upload" ? change.file : null);
  const localUrl = useLocalFileUrl(shownFile, Boolean(shownFile));
  const displayUrl = change.kind === "remove" ? null : localUrl || user.image;

  const pickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset, so picking the same file again still fires
    event.target.value = "";
    if (file) upload.mutate(file);
  };

  return (
    <div className="profile-image-field">
      <span className="profile-image-label">Profile picture</span>
      <div className="profile-avatar-editor">
        <span className="profile-avatar-preview">
          <AvatarFace image={displayUrl} name={user.name} />
        </span>
        <div className="profile-avatar-actions">
          <div className="profile-avatar-buttons">
            <button
              className="profile-image-btn"
              disabled={upload.isPending}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              {upload.isPending ? "Uploading..." : displayUrl ? "Replace" : "Upload"}
            </button>
            {displayUrl ? (
              <button
                className="profile-image-btn"
                disabled={upload.isPending}
                onClick={() => onChange({ kind: "remove" })}
                type="button"
              >
                Remove
              </button>
            ) : null}
            {change.kind !== "keep" && !upload.isPending ? (
              <button className="profile-image-btn" onClick={() => onChange({ kind: "keep" })} type="button">
                Undo
              </button>
            ) : null}
          </div>
          <small className="profile-image-hint">JPG, PNG, WebP or GIF, up to 10 MB</small>
        </div>
        <input accept={IMAGE_ACCEPT} hidden onChange={pickFile} ref={inputRef} type="file" />
      </div>
      {upload.isError ? (
        <p className="profile-image-error" role="alert">
          {upload.error.message || "Upload failed"}
        </p>
      ) : null}
    </div>
  );
}
