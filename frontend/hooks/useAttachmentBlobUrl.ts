'use client';

import { useEffect, useState } from 'react';
import {
  deriveBlobState,
  type AttachmentBlobState,
  type SettledLoad,
} from '../lib/mls/media/attachmentBlobState';
import { loadAttachmentBlob, type AttachmentSource } from '../lib/mls/media/attachmentLoader';

export type { AttachmentBlobState };

/**
 * Decrypts an attachment into an object URL while `enabled`, aborting the download and revoking
 * the URL when the component unmounts or the source changes.
 */
export function useAttachmentBlobUrl(
  source: AttachmentSource | null,
  enabled: boolean,
): AttachmentBlobState {
  const [settled, setSettled] = useState<SettledLoad | null>(null);
  const cacheKey = source?.cacheKey;
  const url = source?.url;

  useEffect(() => {
    if (!enabled || !source || !cacheKey || !url) return undefined;
    const controller = new AbortController();
    let objectUrl: string | undefined;

    loadAttachmentBlob(source, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSettled({ cacheKey, url, outcome: { url: objectUrl } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn('Could not load attachment', error);
        setSettled({ cacheKey, url, outcome: { message: 'This file is unavailable.' } });
      },
    );

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        // the revoked URL must not be shown as 'ready' if this source loads again
        setSettled(null);
      }
    };
    // source is rebuilt each render; its identity is fully captured by cacheKey + url
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey, url]);

  return deriveBlobState(settled, source, enabled);
}
