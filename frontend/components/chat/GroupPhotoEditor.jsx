"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { IMAGE_ACCEPT, useImageUpload } from "../../hooks/useImageUpload";
import { api } from "../../lib/api";
import { AvatarFace } from "../AvatarFace";

/** Pick, drop, replace or remove a group's photo; the upload is saved as soon as it is chosen. */
export function GroupPhotoEditor({ conversationId, name, photoUrl, onChanged }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const { pickFile, pickDropped, displayUrl, isPending, error } = useImageUpload({
    purpose: "GROUP_PHOTO",
    currentUrl: photoUrl,
    save: (mediaUploadId) => api.setGroupPhoto(conversationId, mediaUploadId),
    getUrl: (conversation) => conversation.photoUrl,
    onSaved: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.removeGroupPhoto(conversationId),
    onSuccess: onChanged,
  });
  const busy = isPending || remove.isPending;
  const failure = error || (remove.isError ? remove.error.message || "Could not remove it" : null);

  return (
    <div className="profile-image-field">
      <span className="profile-image-label">Group photo</span>
      <div
        className={`profile-avatar-editor group-photo-drop ${isDragging ? "dragging" : ""}`}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!busy) pickDropped(event.dataTransfer.files);
        }}
      >
        <span className="profile-avatar-preview">
          <AvatarFace image={displayUrl} name={name} />
        </span>
        <div className="profile-avatar-actions">
          <div className="profile-avatar-buttons">
            <button
              className="profile-image-btn"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              {isPending ? "Uploading..." : displayUrl ? "Replace" : "Upload"}
            </button>
            {displayUrl && (
              <button
                className="profile-image-btn"
                disabled={busy}
                onClick={() => remove.mutate()}
                type="button"
              >
                {remove.isPending ? "Removing..." : "Remove"}
              </button>
            )}
          </div>
          <small className="profile-image-hint">Choose a file or drop one here. JPG, PNG, WebP or GIF, up to 10 MB</small>
        </div>
        <input accept={IMAGE_ACCEPT} hidden onChange={pickFile} ref={inputRef} type="file" />
      </div>
      {failure ? (
        <p className="profile-image-error" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
