"use client";

import { useEffect, useState } from "react";

/** An object URL for a local, not-yet-uploaded File, revoked as soon as the file is swapped or dropped. */
export function useLocalFileUrl(file, enabled) {
  // Tagged with the file it belongs to, so a stale URL from the previous file is never returned
  // while this one's is still pending - mirrors useAttachmentBlobUrl's settled/source matching.
  const [settled, setSettled] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const next = URL.createObjectURL(file);
    Promise.resolve().then(() => setSettled({ file, url: next }));
    return () => URL.revokeObjectURL(next);
  }, [file, enabled]);
  if (!enabled || !settled || settled.file !== file) return null;
  return settled.url;
}
