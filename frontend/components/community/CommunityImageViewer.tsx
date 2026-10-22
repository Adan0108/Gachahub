"use client";

import { useEffect } from "react";
import { FiChevronLeft, FiChevronRight, FiX } from "react-icons/fi";
import type { MouseEvent } from "react";
import type { CommunityMedia } from "../../lib/community/communityChat";

/** Full-screen view of one picture of a message, with previous and next through the rest of that message. */
export function CommunityImageViewer({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: CommunityMedia[];
  index: number;
  onClose: () => void;
  onNavigate: (direction: number) => void;
}) {
  const image = images[index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onNavigate(-1);
      if (event.key === "ArrowRight") onNavigate(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate]);

  if (!image) return null;

  const step = (event: MouseEvent, direction: number) => {
    event.stopPropagation();
    onNavigate(direction);
  };

  return (
    <div
      aria-label="Image viewer"
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
          onClick={(event) => step(event, -1)}
          type="button"
        >
          <FiChevronLeft />
        </button>
      )}
      {index < images.length - 1 && (
        <button
          aria-label="Next"
          className="attachment-lightbox-nav next"
          onClick={(event) => step(event, 1)}
          type="button"
        >
          <FiChevronRight />
        </button>
      )}
      <div className="attachment-lightbox-body" onClick={(event) => event.stopPropagation()}>
        <img alt={`Image ${index + 1} of ${images.length}`} src={image.url} />
        {images.length > 1 && (
          <div className="attachment-lightbox-toolbar">
            <span>
              {index + 1} / {images.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
