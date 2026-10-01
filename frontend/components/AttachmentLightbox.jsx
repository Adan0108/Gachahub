"use client";

import { useEffect, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiDownload, FiX } from "react-icons/fi";
import { useAttachmentBlobUrl } from "../hooks/useAttachmentBlobUrl";
import { saveAttachment } from "../lib/mls/media/saveAttachment";

/** Full-screen viewer for one attachment in `items`, with prev/next through the rest of the thread's media. */
export function AttachmentLightbox({ items, index, onClose, onNavigate }) {
  const item = items[index];
  const full = useAttachmentBlobUrl(item?.source ?? null, Boolean(item));
  const [downloadState, setDownloadState] = useState("idle");

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
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

  const stop = (event) => event.stopPropagation();

  return (
    <div
      aria-label="Attachment viewer"
      aria-modal="true"
      className="attachment-lightbox"
      onClick={onClose}
      role="dialog"
    >
      <button aria-label="Close" className="attachment-lightbox-close" onClick={onClose} type="button">
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
        {full.status === "ready" ? (
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
            <FiDownload aria-hidden="true" /> {downloadState === "busy" ? "Decrypting..." : "Download"}
          </button>
          {downloadState === "error" && <span className="chat-attachment-error">File unavailable</span>}
        </div>
      </div>
    </div>
  );
}
