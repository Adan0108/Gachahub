import type { AttachmentFile, EncryptedBlobRef } from '../contract/types';
import { isAttachmentEnvelope } from './attachmentEnvelope';
import { MAX_FILE_NAME_LENGTH } from './limits';

export type AttachmentKind = 'image' | 'video' | 'file';

// Deliberately short: anything else (svg, html, ...) is offered as a download, never rendered
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export function attachmentKind(mime: string): AttachmentKind {
  const normalized = mime.toLowerCase();
  if (IMAGE_MIMES.has(normalized)) return 'image';
  if (VIDEO_MIMES.has(normalized)) return 'video';
  return 'file';
}

/** A GIF is already animated in place; making the user tap it first would just delay the point of sending one. */
export function autoLoadsWithoutTap(mime: string): boolean {
  return mime.toLowerCase() === 'image/gif';
}

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

/** Discord-style grid sections: at most this many visual attachments share one uniform grid. */
export const MAX_ATTACHMENTS_PER_GRID = 6;

/** Splits a message's visual attachments into grid-sized sections, each rendered as its own grid - a 7th image lands in a new section rather than cramming into the first one. */
export function chunkVisualAttachments<T>(
  visual: T[],
  size: number = MAX_ATTACHMENTS_PER_GRID,
): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < visual.length; start += size) {
    chunks.push(visual.slice(start, start + size));
  }
  return chunks;
}

/** What a thread bubble should show for a decrypted envelope; null means an unsupported type. */
export type EnvelopeView =
  | { kind: 'text'; text: string }
  | { kind: 'attachment'; caption: string; files: AttachmentFile[] };

export function envelopeView(envelope: unknown): EnvelopeView | null {
  if (isAttachmentEnvelope(envelope)) {
    return { kind: 'attachment', caption: envelope.body ?? '', files: envelope.files };
  }
  const { type, body } = (envelope ?? {}) as { type?: unknown; body?: unknown };
  return type === 'text' && typeof body === 'string' ? { kind: 'text', text: body } : null;
}

/** No caption and nothing but images/video: the bubble chrome would just be a frame around the media. */
export function isMediaOnlyView(view: EnvelopeView | null): boolean {
  return (
    view?.kind === 'attachment' &&
    !view.caption &&
    view.files.length > 0 &&
    view.files.every((file) => attachmentKind(file.mime) !== 'file')
  );
}

export interface AttachmentSource {
  cacheKey: string;
  url: string;
  ref: EncryptedBlobRef;
  /** Plaintext size from the envelope; absent for thumbnails, which are only size-capped. */
  size?: number;
  mime: string;
}

export interface ResolvedAttachment extends IndexedAttachment {
  source: AttachmentSource | null;
  thumbSource: AttachmentSource | null;
}

function sourceFor(
  messageId: string,
  index: number,
  variant: 'file' | 'thumb',
  ref: EncryptedBlobRef,
  mime: string,
  url: string | undefined,
  size?: number,
): AttachmentSource | null {
  if (!url) return null;
  return { cacheKey: `${messageId}:${index}:${variant}`, url, ref, mime, size };
}

/** Resolves each file/thumb's Cloudinary URL from the message's media rows, keyed by upload id. */
export function resolveAttachmentSources(
  messageId: string,
  files: AttachmentFile[],
  urlByUploadId: Map<string, string>,
): { visual: ResolvedAttachment[]; others: ResolvedAttachment[] } {
  const { visual, others } = groupAttachments(files);
  const withSources = ({ file, index }: IndexedAttachment): ResolvedAttachment => ({
    file,
    index,
    source: sourceFor(messageId, index, 'file', file, file.mime, urlByUploadId.get(file.blob), file.size),
    thumbSource: file.thumb
      ? sourceFor(
          messageId,
          index,
          'thumb',
          file.thumb,
          'image/jpeg',
          urlByUploadId.get(file.thumb.blob),
        )
      : null,
  });
  return { visual: visual.map(withSources), others: others.map(withSources) };
}

export interface FlatAttachment {
  cacheKey: string;
  messageId: string;
  file: AttachmentFile;
  source: AttachmentSource;
  thumbSource: AttachmentSource | null;
}

interface DecryptedById {
  [messageId: string]: { status: string; envelope?: unknown } | undefined;
}

interface MessageWithMedia {
  id: string;
  media?: { mediaUploadId: string; url: string }[];
}

/** Shared by flattenVisualAttachments/flattenOtherAttachments - only which half of a message's resolved attachments `pick` reads back differs. */
function flattenAttachments(
  messages: MessageWithMedia[],
  decryptedById: DecryptedById,
  pick: (resolved: { visual: ResolvedAttachment[]; others: ResolvedAttachment[] }) => ResolvedAttachment[],
): FlatAttachment[] {
  const flat: FlatAttachment[] = [];
  for (const message of messages) {
    if (decryptedById[message.id]?.status !== 'ok') continue;
    const view = envelopeView(decryptedById[message.id]?.envelope);
    if (view?.kind !== 'attachment') continue;
    const urlByUploadId = new Map((message.media ?? []).map((item) => [item.mediaUploadId, item.url]));
    const resolved = resolveAttachmentSources(message.id, view.files, urlByUploadId);
    for (const item of pick(resolved)) {
      if (item.source) {
        flat.push({
          cacheKey: item.source.cacheKey,
          messageId: message.id,
          file: item.file,
          source: item.source,
          thumbSource: item.thumbSource,
        });
      }
    }
  }
  return flat;
}

/** Every image/video across the thread's decrypted messages, in order, so the lightbox can cycle through them. */
export function flattenVisualAttachments(
  messages: MessageWithMedia[],
  decryptedById: DecryptedById,
): FlatAttachment[] {
  return flattenAttachments(messages, decryptedById, (resolved) => resolved.visual);
}

/** Every non-visual (file-chip) attachment across the thread's decrypted messages, in order - the conversation info panel's Files tab. */
export function flattenOtherAttachments(
  messages: MessageWithMedia[],
  decryptedById: DecryptedById,
): FlatAttachment[] {
  return flattenAttachments(messages, decryptedById, (resolved) => resolved.others);
}

/** Status line under an outgoing bubble while it is in flight. */
export function pendingStatusLabel(stage?: 'encrypting' | 'uploading'): string {
  if (stage === 'encrypting') return 'Encrypting...';
  if (stage === 'uploading') return 'Uploading...';
  return 'Sending...';
}
