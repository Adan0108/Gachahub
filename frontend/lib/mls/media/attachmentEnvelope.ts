import type {
  AttachmentEnvelope,
  AttachmentFile,
  AttachmentThumb,
} from '../contract/types';
import { MAX_ATTACHMENT_BYTES, MAX_FILES_PER_MESSAGE, THUMBNAIL_MAX_EDGE } from './limits';

const MAX_NAME_CHARS = 255;
const MAX_MIME_CHARS = 127;
const MAX_BLOB_ID_CHARS = 100;
const MAX_CAPTION_CHARS = 4000;
// AES-256 key / SHA-256 hash and AES-GCM IV sizes
const KEY_BYTES = 32;
const IV_BYTES = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonical padded base64 of exactly `bytes` bytes (32 bytes is 43 chars + one '='). */
function isBase64OfBytes(value: unknown, bytes: number): boolean {
  if (typeof value !== 'string') return false;
  const padding = (3 - (bytes % 3)) % 3;
  const length = 4 * Math.ceil(bytes / 3);
  return new RegExp(`^[A-Za-z0-9+/]{${length - padding}}={${padding}}$`).test(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isIntBetween(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isBlobRef(value: Record<string, unknown>): boolean {
  return (
    isBoundedString(value.blob, MAX_BLOB_ID_CHARS) &&
    isBase64OfBytes(value.key, KEY_BYTES) &&
    isBase64OfBytes(value.iv, IV_BYTES) &&
    isBase64OfBytes(value.sha256, KEY_BYTES)
  );
}

function isThumb(value: unknown): value is AttachmentThumb {
  return (
    isRecord(value) &&
    isBlobRef(value) &&
    isIntBetween(value.width, 1, THUMBNAIL_MAX_EDGE) &&
    isIntBetween(value.height, 1, THUMBNAIL_MAX_EDGE)
  );
}

function isAttachmentFile(value: unknown): value is AttachmentFile {
  return (
    isRecord(value) &&
    isBlobRef(value) &&
    isBoundedString(value.name, MAX_NAME_CHARS) &&
    isBoundedString(value.mime, MAX_MIME_CHARS) &&
    isIntBetween(value.size, 0, MAX_ATTACHMENT_BYTES) &&
    (value.thumb === undefined || isThumb(value.thumb))
  );
}

// a repeated id would let one uploaded blob stand in for several files
function hasUniqueBlobIds(files: AttachmentFile[]): boolean {
  const ids = envelopeBlobIds(files);
  return new Set(ids).size === ids.length;
}

/** Structural check for a decrypted `attachment` envelope - the sender is a peer, so nothing here is trusted. */
export function isAttachmentEnvelope(value: unknown): value is AttachmentEnvelope {
  if (!isRecord(value) || value.v !== 1 || value.type !== 'attachment') return false;
  const { body } = value;
  if (body !== undefined && !(typeof body === 'string' && body.length <= MAX_CAPTION_CHARS)) {
    return false;
  }
  return (
    Array.isArray(value.files) &&
    value.files.length >= 1 &&
    value.files.length <= MAX_FILES_PER_MESSAGE &&
    value.files.every(isAttachmentFile) &&
    hasUniqueBlobIds(value.files)
  );
}

export function buildAttachmentEnvelope(
  files: AttachmentFile[],
  caption: string,
): AttachmentEnvelope {
  const trimmed = caption.trim();
  return { v: 1, type: 'attachment', ...(trimmed ? { body: trimmed } : {}), files };
}

/** Upload ids of every blob (files and thumbnails) the message must attach, file order then thumb. */
export function envelopeBlobIds(files: AttachmentFile[]): string[] {
  return files.flatMap((file) => [file.blob, ...(file.thumb ? [file.thumb.blob] : [])]);
}
