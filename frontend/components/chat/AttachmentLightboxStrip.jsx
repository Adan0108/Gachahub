"use client";

import { useEffect, useRef } from "react";
import { FiPlay } from "react-icons/fi";
import { useAttachmentBlobUrl } from "../../hooks/chat/useAttachmentBlobUrl";
import { attachmentKind } from "../../lib/mls/media/attachmentView";

// Only thumbnails near the open one are decrypted; a long thread would otherwise decrypt every picture at once.
const LOAD_RADIUS = 12;
// A big image with no thumbnail is not decrypted just to fill the strip.
const STRIP_MAX_BYTES = 5 * 1024 * 1024;

function Thumb({ item, near }) {
  const kind = attachmentKind(item.file.mime);
  const source =
    item.thumbSource ?? (kind === "image" && item.file.size <= STRIP_MAX_BYTES ? item.source : null);
  const state = useAttachmentBlobUrl(source, near && Boolean(source));

  return (
    <>
      {state.status === "ready" ? <img alt="" src={state.url} /> : <span className="attachment-lightbox-thumb-blank" />}
      {kind === "video" && <FiPlay aria-hidden="true" className="attachment-lightbox-thumb-play" />}
    </>
  );
}

/** Every picture and video of the thread under the viewer; a click jumps to it. */
export function AttachmentLightboxStrip({ items, index, onSelect }) {
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [index]);

  return (
    <ul aria-label="Media in this chat" className="attachment-lightbox-strip" onClick={(event) => event.stopPropagation()}>
      {items.map((item, at) => (
        <li key={item.cacheKey}>
          <button
            aria-current={at === index ? "true" : undefined}
            aria-label={`Show ${item.file.name}`}
            className={at === index ? "active" : ""}
            onClick={() => onSelect(at)}
            ref={at === index ? activeRef : undefined}
            type="button"
          >
            <Thumb item={item} near={Math.abs(at - index) <= LOAD_RADIUS} />
          </button>
        </li>
      ))}
    </ul>
  );
}
