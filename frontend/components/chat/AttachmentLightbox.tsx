"use client";

import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import type { FlatAttachment } from "../../lib/mls/media/attachmentView";
import { FiChevronLeft, FiChevronRight, FiDownload, FiX } from "react-icons/fi";
import { useAttachmentBlobUrl } from "../../hooks/chat/useAttachmentBlobUrl";
import { attachmentKind } from "../../lib/mls/media/attachmentView";
import { saveAttachment } from "../../lib/mls/media/saveAttachment";
import { AttachmentLightboxStrip } from "./AttachmentLightboxStrip";
import { ChatVideoPlayer } from "./ChatVideoPlayer";

/** Viewer for one picture or video of `items`, with prev/next and a strip of the rest of the thread's media underneath. */
export function AttachmentLightbox({
  items,
  index,
  onClose,
  onNavigate,
}: {
  items: FlatAttachment[];
  index: number;
  onClose: () => void;
  onNavigate: (direction: number) => void;
}) {
  const item = items[index];
  const isVideo = item ? attachmentKind(item.file.mime) === "video" : false;
  const full = useAttachmentBlobUrl(item?.source ?? null, Boolean(item));
  const poster = useAttachmentBlobUrl(item?.thumbSource ?? null, isVideo);
  const [downloadState, setDownloadState] = useState("idle");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowLeft") onNavigate(-1);
      if (event.key === "ArrowRight") onNavigate(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate]);

  if (!item) return null;

  const download = async () => {
    setDownloadState("busy");
    try {
      await saveAttachment(item.source, item.file.name);
      setDownloadState("idle");
    } catch (error) {
      console.warn("Could not download attachment", error);
      setDownloadState("error");
    }
  };

  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div
      aria-label="Attachment viewer"
      aria-modal="true"
      className="attachment-lightbox"
      onClick={onClose}
      role="dialog"
    >
      <button
        aria-label="Close"
        className="attachment-lightbox-close"
        onClick={onClose}
        type="button"
      >
        <FiX />
      </button>
      {index > 0 && (
        <button
          aria-label="Previous"
          className="attachment-lightbox-nav prev"
          onClick={(event) => {
            stop(event);
            onNavigate(-1);
          }}
          type="button"
        >
          <FiChevronLeft />
        </button>
      )}
      {index < items.length - 1 && (
        <button
          aria-label="Next"
          className="attachment-lightbox-nav next"
          onClick={(event) => {
            stop(event);
            onNavigate(1);
          }}
          type="button"
        >
          <FiChevronRight />
        </button>
      )}
      <div className="attachment-lightbox-body" onClick={stop}>
        {full.status === "ready" && isVideo ? (
          <ChatVideoPlayer
            autoPlay
            hideExpand
            key={item.cacheKey}
            label={item.file.name}
            poster={poster.status === "ready" ? poster.url : undefined}
            src={full.url}
          />
        ) : full.status === "ready" ? (
          <img alt={item.file.name} src={full.url} />
        ) : (
          <span className="chat-attachment-status">
            {full.status === "error" ? full.message : "Decrypting..."}
          </span>
        )}
        <div className="attachment-lightbox-toolbar">
          {items.length > 1 && (
            <span>
              {index + 1} / {items.length}
            </span>
          )}
          <button disabled={downloadState === "busy"} onClick={download} type="button">
            <FiDownload aria-hidden="true" />{" "}
            {downloadState === "busy" ? "Decrypting..." : "Download"}
          </button>
          {downloadState === "error" && (
            <span className="chat-attachment-error">File unavailable</span>
          )}
        </div>
      </div>
      {items.length > 1 && (
        <AttachmentLightboxStrip index={index} items={items} onSelect={(at: number) => onNavigate(at - index)} />
      )}
    </div>
  );
}
