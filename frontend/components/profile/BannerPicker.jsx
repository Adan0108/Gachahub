"use client";

import { useQuery } from "@tanstack/react-query";
import { FiLock } from "react-icons/fi";
import { useProfileImages } from "../../hooks/useProfileImages";
import { bannerTone } from "../../lib/profileBanners";
import { queries } from "../../lib/queries";

/** Choose the profile banner from the designs we offer; locked ones are shown but not selectable. */
export function BannerPicker({ currentId }) {
  const options = useQuery(queries.bannerOptions());
  const { saveBanner, removeBanner } = useProfileImages();
  const busy = saveBanner.isPending || removeBanner.isPending;
  const failedWrite = saveBanner.isError ? saveBanner : removeBanner.isError ? removeBanner : null;

  return (
    <div className="profile-image-field">
      <span className="profile-image-label">Profile banner</span>
      {options.isError ? (
        <p className="profile-image-error" role="alert">
          Could not load banners
        </p>
      ) : (
        <div aria-label="Profile banner" className="banner-picker" role="radiogroup">
          {(options.data ?? []).map((option) => (
            <button
              aria-checked={option.id === currentId}
              className={`banner-option art-${bannerTone(option.id)}`}
              disabled={busy || !option.available}
              key={option.id}
              onClick={() => saveBanner.mutate(option.id)}
              role="radio"
              type="button"
            >
              <span>{option.label}</span>
              {option.available ? null : <FiLock aria-label="Locked" />}
            </button>
          ))}
        </div>
      )}
      {currentId ? (
        <button
          className="soft-btn"
          disabled={busy}
          onClick={() => removeBanner.mutate()}
          type="button"
        >
          Use default banner
        </button>
      ) : null}
      {failedWrite ? (
        <p className="profile-image-error" role="alert">
          {failedWrite.error.message || "Could not update your banner"}
        </p>
      ) : null}
    </div>
  );
}
