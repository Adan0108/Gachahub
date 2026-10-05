"use client";

import { useQuery } from "@tanstack/react-query";
import { FiCheck, FiLock } from "react-icons/fi";
import { useProfileImages } from "../../hooks/useProfileImages";
import { bannerColor } from "../../lib/profileBanners";
import { queries } from "../../lib/queries";

/** Choose the profile banner from the colours we offer; locked ones are shown but not selectable. */
export function BannerPicker({ currentId }) {
  const options = useQuery(queries.bannerOptions());
  const { saveBanner, removeBanner } = useProfileImages();
  const busy = saveBanner.isPending || removeBanner.isPending;
  const failedWrite = saveBanner.isError ? saveBanner : removeBanner.isError ? removeBanner : null;

  return (
    <div className="profile-image-field">
      <div className="profile-image-heading">
        <span className="profile-image-label">Profile banner</span>
        {currentId ? (
          <button
            className="profile-image-link"
            disabled={busy}
            onClick={() => removeBanner.mutate()}
            type="button"
          >
            Reset to default
          </button>
        ) : null}
      </div>
      {options.isError ? (
        <p className="profile-image-error" role="alert">
          Could not load banners
        </p>
      ) : (
        <div aria-label="Profile banner" className="banner-picker" role="radiogroup">
          {(options.data ?? []).map((option) => (
            <button
              aria-checked={option.id === currentId}
              aria-label={option.label}
              className="banner-swatch"
              disabled={busy || !option.available}
              key={option.id}
              onClick={() => saveBanner.mutate(option.id)}
              role="radio"
              style={{ backgroundColor: bannerColor(option.id) ?? undefined }}
              title={option.label}
              type="button"
            >
              {option.id === currentId ? <FiCheck aria-hidden="true" /> : null}
              {option.available ? null : <FiLock aria-label="Locked" />}
            </button>
          ))}
        </div>
      )}
      {failedWrite ? (
        <p className="profile-image-error" role="alert">
          {failedWrite.error.message || "Could not update your banner"}
        </p>
      ) : null}
    </div>
  );
}
