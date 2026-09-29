"use client";

import { useState } from "react";
import { FiPlay } from "react-icons/fi";
import { useAttachmentBlobUrl } from "../hooks/useAttachmentBlobUrl";
import { useOpenAttachment } from "../lib/mls/media/attachmentLightboxContext";
import { autoLoadsWithoutTap } from "../lib/mls/media/attachmentView";
import { DownloadButton } from "./AttachmentFileChip";
import "./ChatAttachments.css";

// Bigger images wait for the lightbox instead of downloading as soon as they scroll into the thread.
const AUTO_LOAD_MAX_BYTES = 5 * 1024 * 1024;

function tileStyle(thumb) {
  return thumb ? { aspectRatio: `${thumb.width} / ${thumb.height}` } : undefined;
}

function TileStatus({ state, idleLabel }) {
  if (state.status === "error") {
    return <span className="chat-attachment-status chat-attachment-error">{state.message}</span>;
  }
  return (
    <span className="chat-attachment-status">
      {state.status === "loading" ? "Decrypting..." : idleLabel}
    </span>
  );
}

/** A GIF always auto-loads; other images show their thumbnail (or auto-load when small) and open the lightbox on click. */
export function ImageTile({ file, source, thumbSource, uniform }) {
  const openAttachment = useOpenAttachment();
  const autoLoadsFull = autoLoadsWithoutTap(file.mime) || (!thumbSource && file.size <= AUTO_LOAD_MAX_BYTES);
  const preview = useAttachmentBlobUrl(thumbSource, true);
  const full = useAttachmentBlobUrl(source, autoLoadsFull && Boolean(source));
  const shown = full.status === "ready" ? full : preview;

  if (!source) return <span className="chat-attachment-error">File unavailable</span>;

  return (
    <button
      aria-label={`Open ${file.name}`}
      className={`chat-attachment-tile ${shown.status === "loading" ? "busy" : ""}`}
      onClick={() => openAttachment(source.cacheKey)}
      // A grouped tile crops to a uniform square (see .chat-attachment-grid:not(.count-1) in
      // ChatAttachments.css) - the image's own ratio would otherwise fight that via this inline
      // style, which always wins over a class rule.
      style={uniform ? undefined : tileStyle(file.thumb)}
      type="button"
    >
      {shown.status === "ready" ? (
        <img alt={file.name} src={shown.url} />
      ) : (
        <TileStatus idleLabel="Tap to load" state={shown} />
      )}
    </button>
  );
}

/** Click-to-load: nothing but the poster (if any) is fetched until the user asks to play. */
export function VideoTile({ file, source, thumbSource, uniform }) {
  const [playing, setPlaying] = useState(false);
  const poster = useAttachmentBlobUrl(thumbSource, true);
  const video = useAttachmentBlobUrl(source, playing && Boolean(source));

  if (!source) return <span className="chat-attachment-error">File unavailable</span>;

  return (
    <div>
      {video.status === "ready" ? (
        <video autoPlay className="chat-attachment-tile" controls src={video.url} />
      ) : (
        <button
          aria-label={`Play ${file.name}`}
          className={`chat-attachment-tile ${video.status === "loading" ? "busy" : ""}`}
          onClick={() => setPlaying(true)}
          style={uniform ? undefined : tileStyle(file.thumb)}
          type="button"
        >
          {poster.status === "ready" && <img alt="" src={poster.url} />}
          {video.status === "error" ? (
            <TileStatus state={video} />
          ) : (
            <span className="chat-attachment-play">
              {video.status === "loading" ? "Decrypting..." : <FiPlay aria-hidden="true" />}
            </span>
          )}
        </button>
      )}
      <DownloadButton name={file.name} source={source} />
    </div>
  );
}
