import { MAX_THUMBNAIL_BYTES, THUMBNAIL_MAX_EDGE } from './limits';

export interface Thumbnail {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Scales down to fit `maxEdge` on the longer side, never up, never below 1px. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const JPEG_QUALITIES = [0.7, 0.5, 0.3];

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function encodeUnderCap(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, width, height);
  for (const quality of JPEG_QUALITIES) {
    const blob = await canvasToJpeg(canvas, quality);
    if (blob && blob.size <= MAX_THUMBNAIL_BYTES) {
      return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
    }
  }
  return null;
}

async function imageThumbnail(file: Blob): Promise<Thumbnail | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    return await encodeUnderCap(bitmap, size.width, size.height);
  } finally {
    bitmap.close();
  }
}

function videoThumbnail(file: Blob): Promise<Thumbnail | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const finish = (result: Thumbnail | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), 5000);
    video.muted = true;
    video.preload = 'auto';
    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      const size = fitWithin(video.videoWidth, video.videoHeight);
      encodeUnderCap(video, size.width, size.height).then(finish, () => finish(null));
    };
    video.src = url;
  });
}

/** Best-effort preview: null for anything the browser can't decode - the attachment still sends without one. */
export async function generateThumbnail(file: File): Promise<Thumbnail | null> {
  try {
    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      return await imageThumbnail(file);
    }
    if (file.type.startsWith('video/')) return await videoThumbnail(file);
  } catch {
    return null;
  }
  return null;
}
