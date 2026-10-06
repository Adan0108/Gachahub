import { cleanText } from '../../chat/cleanText';
import { findLinks, withoutFragment } from '../../chat/linkify';
import type { BodyEnvelope, LinkPreviewRef } from '../contract/types';
import { isThumb } from '../media/attachmentEnvelope';

const MAX_URL_LENGTH = 2048;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;
const MAX_SITE_NAME = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The address as a plain http(s) link without credentials or fragment, or null. */
function normalisedUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    const ok = (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '';
    return ok ? withoutFragment(url.href) : null;
  } catch {
    return null;
  }
}

function readPreview(value: unknown, text: string): LinkPreviewRef | null {
  if (!isRecord(value)) return null;

  const url = normalisedUrl(value.url);
  // A card may only be for a link that is actually in the message, so it cannot show one address and send you to another
  if (!url || !findLinks(text).some((link) => withoutFragment(link.href) === url)) return null;

  const title = cleanText(value.title, MAX_TITLE);
  const description = cleanText(value.description, MAX_DESCRIPTION);
  const siteName = cleanText(value.siteName, MAX_SITE_NAME);
  const thumb = isThumb(value.thumb) ? value.thumb : undefined;
  if (!title && !thumb) return null;

  return {
    url,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(siteName ? { siteName } : {}),
    ...(thumb ? { thumb } : {}),
  };
}

/** The preview card for a decrypted text message, or none; the sender is a peer, so every part is checked and cleaned. */
export function readLinkPreviews(envelope: unknown): LinkPreviewRef[] {
  if (!isRecord(envelope) || envelope.v !== 1 || envelope.type !== 'text') return [];
  if (typeof envelope.body !== 'string' || !Array.isArray(envelope.previews)) return [];

  for (const candidate of envelope.previews as unknown[]) {
    const preview = readPreview(candidate, envelope.body);
    if (preview) return [preview];
  }
  return [];
}

/** A text message, with its preview card when it has one. */
export function buildTextEnvelope(text: string, preview?: LinkPreviewRef): BodyEnvelope {
  return { v: 1, type: 'text', body: text, ...(preview ? { previews: [preview] } : {}) };
}

/** Upload ids of the blobs a preview needs attached to its message. */
export function previewBlobIds(preview: LinkPreviewRef | undefined): string[] {
  return preview?.thumb ? [preview.thumb.blob] : [];
}
