"use client";

import { useEffect, useRef } from "react";

export function PostMediaPreview({ file }: { file: File }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const preview = URL.createObjectURL(file);
    const element = videoRef.current || imageRef.current;
    if (element) element.src = preview;
    return () => URL.revokeObjectURL(preview);
  }, [file]);

  return file.type.startsWith("video/") ? (
    <video aria-label={`Preview ${file.name}`} controls preload="metadata" ref={videoRef} />
  ) : (
    <img alt={`Preview ${file.name}`} ref={imageRef} />
  );
}
