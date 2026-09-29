"use client";

import { createContext, useContext } from "react";

/** Set by the thread page; clicking an image/gif calls this with its cacheKey to open the lightbox. */
export const AttachmentLightboxContext = createContext<((cacheKey: string) => void) | null>(null);

export function useOpenAttachment(): (cacheKey: string) => void {
  const openAttachment = useContext(AttachmentLightboxContext);
  if (!openAttachment) {
    console.warn("useOpenAttachment: no AttachmentLightboxContext.Provider above this component");
    return () => {};
  }
  return openAttachment;
}
