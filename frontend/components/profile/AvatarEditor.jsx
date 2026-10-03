"use client";

import { useRef } from "react";
import { AvatarFace } from "../AvatarFace";
import { IMAGE_ACCEPT, useImageUpload } from "../../hooks/useImageUpload";
import { useProfileImages } from "../../hooks/useProfileImages";
import { api } from "../../lib/api";

/** Pick, replace or remove the signed-in user's profile picture. */
export function AvatarEditor({ user }) {
  const inputRef = useRef(null);
  const { cacheUser, removeAvatar } = useProfileImages();
  const { pickFile, displayUrl, isPending, error } = useImageUpload({
    purpose: "AVATAR",
    currentUrl: user.image,
    save: api.updateAvatar,
    getUrl: (updated) => updated.image,
    onSaved: cacheUser,
  });
  const busy = isPending || removeAvatar.isPending;
  const failure =
    error || (removeAvatar.isError ? removeAvatar.error.message || "Could not remove it" : null);

  return (
    <div className="profile-image-field">
      <span className="profile-image-label">Profile picture</span>
      <div className="profile-avatar-editor">
        <span className="profile-avatar-preview">
          <AvatarFace image={displayUrl} name={user.name} />
        </span>
        <button
          className="soft-btn"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          {isPending ? "Uploading..." : displayUrl ? "Replace" : "Upload"}
        </button>
        {displayUrl ? (
          <button
            className="soft-btn"
            disabled={busy}
            onClick={() => removeAvatar.mutate()}
            type="button"
          >
            Remove
          </button>
        ) : null}
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
