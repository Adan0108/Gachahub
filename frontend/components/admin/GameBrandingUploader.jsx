"use client";

import { useRef } from "react";
import { FiImage, FiLoader } from "react-icons/fi";
import { IMAGE_ACCEPT, useImageUpload } from "../../hooks/useImageUpload";
import { api } from "../../lib/api";

// Single source of truth for which game field/column a branding purpose maps to.
const BRANDING_FIELDS = {
  GAME_ICON: { dtoField: "iconMediaUploadId", urlField: "iconUrl" },
  GAME_BANNER: { dtoField: "bannerMediaUploadId", urlField: "bannerUrl" },
};

// One image picker for a game's icon or banner - used by both the admin Communities form and the moderator's own page.
export function GameBrandingUploader({ gameSlug, purpose, label, currentUrl, onUpdated }) {
  const inputRef = useRef(null);
  const fields = BRANDING_FIELDS[purpose];
  const { pickFile, displayUrl, isPending, error } = useImageUpload({
    purpose,
    currentUrl,
    save: (mediaUploadId) =>
      api.updateGameBranding(gameSlug, { [fields.dtoField]: mediaUploadId }),
    getUrl: (game) => game[fields.urlField],
    onSaved: onUpdated,
  });

  return (
    <div className="branding-uploader">
      <span className="branding-uploader-preview">
        {displayUrl ? <img alt="" src={displayUrl} /> : <FiImage aria-hidden="true" />}
        {isPending ? <FiLoader aria-hidden="true" className="branding-uploader-spinner" /> : null}
      </span>
      <div className="branding-uploader-body">
        <span>{label}</span>
        <button
          className="admin-button admin-button-secondary"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          {isPending ? "Uploading..." : displayUrl ? "Replace" : "Upload"}
        </button>
        {error ? (
          <p className="admin-form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <input accept={IMAGE_ACCEPT} hidden onChange={pickFile} ref={inputRef} type="file" />
    </div>
  );
}
