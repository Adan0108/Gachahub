import { registerSessionCleanup } from '../../sessionCleanup';
import type { EncryptedBlobRef } from '../contract/types';
import { AttachmentError, decryptAttachment } from './attachmentCrypto';
import { safeBlobType } from './attachmentView';
import { BlobCache } from './blobCache';
import { GCM_TAG_BYTES, MAX_ATTACHMENT_BYTES, MAX_THUMBNAIL_BYTES } from './limits';

const TRUSTED_HOST = 'res.cloudinary.com';

const cache = new BlobCache(64 * 1024 * 1024);

interface InFlight {
  promise: Promise<Blob>;
  controller: AbortController;
  waiters: number;
}
const inFlight = new Map<string, InFlight>();

// The server picks this URL; a peer's client must never be steered to fetch from anywhere else.
export function isTrustedBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === TRUSTED_HOST &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

export interface AttachmentSource {
  /** Cache key, unique per message + file + variant. */
  cacheKey: string;
  url: string;
  ref: EncryptedBlobRef;
  /** Plaintext size from the envelope; absent for thumbnails, which are only size-capped. */
  size?: number;
  mime: string;
}

const tooLarge = () => new AttachmentError('too-large', 'Encrypted file is larger than allowed');

/** Reads the body but gives up as soon as it passes `maxBytes`, so a hostile host can't fill memory. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) throw new AttachmentError('malformed', 'Download has no body');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function download(source: AttachmentSource, signal: AbortSignal): Promise<Blob> {
  if (!isTrustedBlobUrl(source.url)) {
    throw new AttachmentError('malformed', 'Attachment location is not trusted');
  }
  const response = await fetch(source.url, { credentials: 'omit', redirect: 'error', signal });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);

  const maxBytes = source.size === undefined ? MAX_THUMBNAIL_BYTES : MAX_ATTACHMENT_BYTES;
  const limit = (source.size ?? maxBytes) + GCM_TAG_BYTES;
  const ciphertext = await readCapped(response, limit);
  if (source.size !== undefined && ciphertext.byteLength !== limit) {
    throw new AttachmentError('integrity', 'Downloaded file has the wrong size');
  }
  const plaintext = await decryptAttachment(ciphertext, source.ref, maxBytes);
  return new Blob([plaintext as BlobPart], { type: safeBlobType(source.mime) });
}

function startDownload(source: AttachmentSource): InFlight {
  const controller = new AbortController();
  const entry: InFlight = {
    controller,
    waiters: 0,
    promise: download(source, controller.signal)
      .then((blob) => {
        // a clear (logout) drops the entry, so a finished-late download is not cached
        if (inFlight.get(source.cacheKey) === entry) cache.set(source.cacheKey, blob);
        return blob;
      })
      .finally(() => {
        if (inFlight.get(source.cacheKey) === entry) inFlight.delete(source.cacheKey);
      }),
  };
  // an abandoned (aborted) download must not surface as an unhandled rejection
  entry.promise.catch(() => {});
  return entry;
}

const abortError = () => new DOMException('Attachment load aborted', 'AbortError');

/** Each caller can leave on its own; the shared download is aborted once nobody is waiting. */
function waitFor(entry: InFlight, signal?: AbortSignal): Promise<Blob> {
  entry.waiters += 1;
  return new Promise<Blob>((resolve, reject) => {
    const onAbort = () => {
      entry.waiters -= 1;
      if (entry.waiters === 0) entry.controller.abort();
      reject(abortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(
      (blob) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(blob);
      },
      (error: unknown) => {
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Downloads and decrypts once per cache key; concurrent callers share the same request. */
export function loadAttachmentBlob(source: AttachmentSource, signal?: AbortSignal): Promise<Blob> {
  const cached = cache.get(source.cacheKey);
  if (cached) return Promise.resolve(cached);

  let entry = inFlight.get(source.cacheKey);
  if (!entry) {
    entry = startDownload(source);
    inFlight.set(source.cacheKey, entry);
  }
  return waitFor(entry, signal);
}

/** Drops all decrypted plaintext and cancels pending downloads (logout / account switch). */
export function clearAttachmentCache(): void {
  cache.clear();
  for (const entry of inFlight.values()) entry.controller.abort();
  inFlight.clear();
}

registerSessionCleanup(clearAttachmentCache);
