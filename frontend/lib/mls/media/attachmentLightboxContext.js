"use client";

import { createContext, useContext } from "react";

/** Set by the thread page; clicking an image/gif calls this with its cacheKey to open the lightbox. */
export const AttachmentLightboxContext = createContext(null);

export function useOpenAttachment() {
  return useContext(AttachmentLightboxContext) ?? (() => {});
}
