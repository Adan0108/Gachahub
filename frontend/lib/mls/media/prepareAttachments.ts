import type { AttachmentFile } from '../contract/types';
import { AttachmentError, encryptAttachment } from './attachmentCrypto';
import { attachmentKind } from './attachmentView';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_FILES_PER_MESSAGE,
  MAX_FILE_NAME_LENGTH,
  MAX_THUMBNAIL_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  THUMBNAIL_MAX_EDGE_GROUPED,
  THUMBNAIL_MAX_EDGE_SOLO,
} from './limits';
import { generateThumbnail } from './thumbnail';

export interface OpaqueBlob {
  bytes: Uint8Array;
  kind: 'BLOB' | 'THUMB';
}

/** Uploads encrypted bytes and returns one upload id per blob, in order. */
export type BlobUploader = (blobs: OpaqueBlob[]) => Promise<string[]>;

export type AttachmentStage = 'encrypting' | 'uploading';

export function assertSendable(files: Pick<File, 'name' | 'size'>[]): void {
  if (files.length > MAX_FILES_PER_MESSAGE) {
    throw new AttachmentError('too-large', `Attach at most ${MAX_FILES_PER_MESSAGE} files`);
  }
  const oversized = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
  if (oversized) {
    throw new AttachmentError('too-large', `${oversized.name} is too large to send`);
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new AttachmentError('too-large', 'These files are too large to send together');
  }
}

/** Files already encrypted and uploaded, by selection index; a retry keeps them instead of re-uploading. */
export type PreparedFiles = Map<number, AttachmentFile>;

async function prepareOne(
  file: File,
  upload: BlobUploader,
  onStage: (stage: AttachmentStage) => void,
  thumbnailMaxEdge: number,
): Promise<AttachmentFile> {
  onStage('encrypting');
  const encrypted = await encryptAttachment(new Uint8Array(await file.arrayBuffer()));
  const preview = await generateThumbnail(file, thumbnailMaxEdge);
  const thumb = preview
    ? { ...(await encryptAttachment(preview.bytes, MAX_THUMBNAIL_BYTES)), preview }
    : undefined;

  const blobs: OpaqueBlob[] = [{ bytes: encrypted.ciphertext, kind: 'BLOB' }];
  if (thumb) blobs.push({ bytes: thumb.ciphertext, kind: 'THUMB' });

  onStage('uploading');
  const ids = await upload(blobs);
  if (ids.length !== blobs.length) {
    throw new AttachmentError('malformed', 'Upload returned an unexpected number of files');
  }

  return {
    name: file.name.slice(0, MAX_FILE_NAME_LENGTH) || 'file',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    blob: ids[0]!,
    key: encrypted.key,
    iv: encrypted.iv,
    sha256: encrypted.sha256,
    ...(thumb
      ? {
          thumb: {
            blob: ids[1]!,
            key: thumb.key,
            iv: thumb.iv,
            sha256: thumb.sha256,
            width: thumb.preview.width,
            height: thumb.preview.height,
          },
        }
      : {}),
  };
}

/** How many files are encrypted and uploaded at the same moment: enough to overlap the waiting, few enough to keep the tab responsive. */
export const PREPARE_CONCURRENCY = 3;

/**
 * Encrypts and uploads the files a few at a time, recording each in `done` as it finishes so a
 * failure never orphans finished files. After a failure nothing new is started, the ones already
 * under way are let finish (and kept), and the first error is thrown.
 */
export async function prepareAttachments(
  files: File[],
  upload: BlobUploader,
  onStage: (stage: AttachmentStage) => void = () => {},
  done: PreparedFiles = new Map(),
): Promise<AttachmentFile[]> {
  assertSendable(files);

  // A message with exactly one image/video renders it large (the full-width, count-1 layout in
  // ChatAttachments.css) - worth a sharper thumbnail than when it's sharing the message with
  // others and rendering small, as one tile in a grid.
  const visualCount = files.filter((file) => attachmentKind(file.type) !== 'file').length;
  const thumbnailMaxEdge = visualCount === 1 ? THUMBNAIL_MAX_EDGE_SOLO : THUMBNAIL_MAX_EDGE_GROUPED;

  const waiting = files.map((_, index) => index).filter((index) => !done.has(index));
  let failure: { error: unknown } | undefined;

  const worker = async () => {
    for (let index = waiting.shift(); index !== undefined; index = waiting.shift()) {
      if (failure) return;
      try {
        done.set(index, await prepareOne(files[index]!, upload, onStage, thumbnailMaxEdge));
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREPARE_CONCURRENCY, waiting.length) }, worker));

  if (failure) throw failure.error;
  return files.map((_, index) => done.get(index)!);
}
