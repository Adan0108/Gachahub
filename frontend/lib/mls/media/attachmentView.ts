import type { AttachmentFile } from '../contract/types';
import { isAttachmentEnvelope } from './attachmentEnvelope';
import { MAX_FILE_NAME_LENGTH } from './limits';

export type AttachmentKind = 'image' | 'video' | 'file';

// Deliberately short: anything else (svg, html, ...) is offered as a download, never rendered.
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export function attachmentKind(mime: string): AttachmentKind {
  const normalized = mime.toLowerCase();
  if (IMAGE_MIMES.has(normalized)) return 'image';
  if (VIDEO_MIMES.has(normalized)) return 'video';
  return 'file';
}

/** The mime the sender claimed only reaches a blob when it is one we render; otherwise it stays opaque. */
export function safeBlobType(mime: string): string {
  return attachmentKind(mime) === 'file' ? 'application/octet-stream' : mime.toLowerCase();
}

// control chars, path-hostile chars, bidi overrides/isolates, zero-width and format chars
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f<>:"|?*​-‏‪-‮⁠⁦-⁩﻿]/g;
// Windows reserves these device names with or without an extension
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Strips path parts and unsafe characters from a peer-supplied name before it becomes a download name. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(UNSAFE_NAME_CHARS, '')
    .replace(/^\.+/, '')
    .slice(0, MAX_FILE_NAME_LENGTH)
    .replace(/[. ]+$/, '')
    .trim();
  if (!cleaned) return 'file';
  return WINDOWS_RESERVED.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface IndexedAttachment {
  file: AttachmentFile;
  index: number;
}

/** Splits a message's files into a visual grid (images/video) and download chips, keeping each file's original index. */
export function groupAttachments(files: AttachmentFile[]): {
  visual: IndexedAttachment[];
  others: IndexedAttachment[];
} {
  const visual: IndexedAttachment[] = [];
  const others: IndexedAttachment[] = [];
  files.forEach((file, index) => {
    (attachmentKind(file.mime) === 'file' ? others : visual).push({ file, index });
  });
  return { visual, others };
}

/** What a thread bubble should show for a decrypted envelope; null means an unsupported type. */
export type EnvelopeView =
  | { kind: 'text'; text: string }
  | { kind: 'attachment'; caption: string; files: AttachmentFile[] };

// re-validated because the local cache and history restores are not covered by the decrypt-time check
export function envelopeView(envelope: unknown): EnvelopeView | null {
  if (isAttachmentEnvelope(envelope)) {
    return { kind: 'attachment', caption: envelope.body ?? '', files: envelope.files };
  }
  const { type, body } = (envelope ?? {}) as { type?: unknown; body?: unknown };
  return type === 'text' && typeof body === 'string' ? { kind: 'text', text: body } : null;
}

/** Status line under an outgoing bubble while it is in flight. */
export function pendingStatusLabel(stage?: 'encrypting' | 'uploading'): string {
  if (stage === 'encrypting') return 'Encrypting...';
  if (stage === 'uploading') return 'Uploading...';
  return 'Sending...';
}
