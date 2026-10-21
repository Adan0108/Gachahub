"use client";

import { useState } from "react";
import { CommunityImageViewer } from "./CommunityImageViewer";

/** The pictures of one message as a small grid; a click opens the viewer on that one. */
export function CommunityImages({ images }) {
  const [viewing, setViewing] = useState(null);
  if (!images?.length) return null;

  const navigate = (direction) =>
    setViewing((current) => Math.min(Math.max(current + direction, 0), images.length - 1));

  return (
    <>
      <div className={`community-media count-${images.length}`}>
        {images.map((image, index) => (
          <button
            aria-label={`Open image ${index + 1} of ${images.length}`}
            key={image.id}
            onClick={() => setViewing(index)}
            type="button"
          >
            <img
              alt=""
              height={image.height ?? undefined}
              loading="lazy"
              src={image.url}
              width={image.width ?? undefined}
            />
          </button>
        ))}
      </div>
      {viewing !== null && (
        <CommunityImageViewer
          images={images}
          index={viewing}
          onClose={() => setViewing(null)}
          onNavigate={navigate}
        />
      )}
    </>
  );
}
