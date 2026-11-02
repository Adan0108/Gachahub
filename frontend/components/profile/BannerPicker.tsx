"use client";

import { useQuery } from "@tanstack/react-query";
import { FiCheck, FiLock } from "react-icons/fi";
import { bannerColor } from "../../lib/profileBanners";
import { queries } from "../../lib/queries";

/** Choose the profile banner from the colours we offer; locked ones are shown but not selectable. Saved with the dialog's Save. */
export function BannerPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (bannerPresetId: string | null) => void;
}) {
  const options = useQuery(queries.bannerOptions());

  return (
    <div className="profile-image-field">
      <div className="profile-image-heading">
        <span className="profile-image-label">Profile banner</span>
        {value ? (
          <button className="profile-image-link" onClick={() => onChange(null)} type="button">
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
          {((options.data ?? []) as { id: string; label: string; available: boolean }[]).map(
            (option) => (
              <button
                aria-checked={option.id === value}
                aria-label={option.label}
                className="banner-swatch"
                disabled={!option.available}
                key={option.id}
                onClick={() => onChange(option.id)}
                role="radio"
                style={{ backgroundColor: bannerColor(option.id) ?? undefined }}
                title={option.label}
                type="button"
              >
                {option.id === value ? <FiCheck aria-hidden="true" /> : null}
                {option.available ? null : <FiLock aria-label="Locked" />}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
