"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { initialOf } from "../lib/chat/chatDisplay";

/** What goes inside a user's avatar circle: their picture, or `fallback` (default: their initial) when they have none or it fails to load. */
export function AvatarFace({
  name,
  image,
  fallback,
}: {
  name?: string | null;
  image?: string | null;
  fallback?: ReactNode;
}) {
  // Tagged with the url that failed, so a new picture is tried again without an effect to reset it.
  const [failedImage, setFailedImage] = useState<string | null>(null);

  if (image && image !== failedImage) {
    return <img alt="" className="avatar-img" onError={() => setFailedImage(image)} src={image} />;
  }

  return fallback ?? initialOf(name);
}
