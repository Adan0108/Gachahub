"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { initialOf } from "../lib/chat/chatDisplay";
import type { EquippedCosmetic } from "../lib/cosmetics";

export function CosmeticFrameOverlay({
  frame,
}: {
  frame?: EquippedCosmetic | null;
}) {
  if (!frame) return null;
  const presetClass = frame.presetId
    ? `cosmetic-preset-${frame.presetId}`
    : "";
  return (
    <span
      aria-hidden="true"
      className={`avatar-frame-overlay ${presetClass}`.trim()}
      data-frame-slug={frame.slug}
    >
      {frame.assetUrl ? <img alt="" src={frame.assetUrl} /> : null}
    </span>
  );
}

/** What goes inside a user's avatar circle: their picture, or `fallback` (default: their initial) when they have none or it fails to load, plus an optional cosmetic frame overlay. */
export function AvatarFace({
  name,
  image,
  fallback,
  frame,
}: {
  name?: string | null;
  image?: string | null;
  fallback?: ReactNode;
  frame?: EquippedCosmetic | null;
}) {
  // Tagged with the url that failed, so a new picture is tried again without an effect to reset it.
  const [failedImage, setFailedImage] = useState<string | null>(null);

  const face =
    image && image !== failedImage ? (
      <img
        alt=""
        className="avatar-img"
        onError={() => setFailedImage(image)}
        src={image}
      />
    ) : (
      (fallback ?? initialOf(name))
    );

  if (!frame) {
    return face;
  }

  return (
    <>
      {face}
      <CosmeticFrameOverlay frame={frame} />
    </>
  );
}
