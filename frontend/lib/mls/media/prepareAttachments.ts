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

/** Encrypts and uploads one file at a time, recording each in `done` so a failure never orphans finished files. */
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

  for (const [index, file] of files.entries()) {
    if (done.has(index)) continue;
    done.set(index, await prepareOne(file, upload, onStage, thumbnailMaxEdge));
  }
  return files.map((_, index) => done.get(index)!);
}
