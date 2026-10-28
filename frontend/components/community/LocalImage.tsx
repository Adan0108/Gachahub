"use client";

import { useLocalFileUrl } from "../../hooks/useLocalFileUrl";

/** A picture that is still on this device, shown from the file itself. */
export function LocalImage({ file, alt = "" }: { file: File; alt?: string }) {
  const url = useLocalFileUrl(file, true);
  return url ? <img alt={alt} src={url} /> : <span aria-hidden="true" className="community-local-blank" />;
}
