import { cleanText } from '../../chat/cleanText';
import type { LinkPreviewRef } from '../contract/types';
import { base64ToBytes } from '../storage/base64';
import { encryptAttachment } from './attachmentCrypto';
import { MAX_THUMBNAIL_BYTES, THUMBNAIL_MAX_EDGE_GROUPED } from './limits';
import type { BlobUploader } from './prepareAttachments';
import { generateThumbnail } from './thumbnail';

/** What the server's `POST /link-previews` answers with. */
export interface LinkPreviewData {
  url: string;
  domain: string;
  /** Where the link really leads when it redirects to another site. */
  resolvedDomain: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: { mime: string; data: string } | null;
}

/** The picture shrunk, encrypted and uploaded as a regular blob (the server only takes a THUMB beside its attachment); null on any failure. */
async function uploadThumb(image: NonNullable<LinkPreviewData['image']>, upload: BlobUploader) {
  try {
    const file = new File([base64ToBytes(image.data) as BlobPart], 'preview', { type: image.mime });
    const thumbnail = await generateThumbnail(file, THUMBNAIL_MAX_EDGE_GROUPED);
    if (!thumbnail) return null;

    const encrypted = await encryptAttachment(thumbnail.bytes, MAX_THUMBNAIL_BYTES);
    const [blob] = await upload([{ bytes: encrypted.ciphertext, kind: 'BLOB' }]);
    if (!blob) return null;

    return {
      blob,
      key: encrypted.key,
      iv: encrypted.iv,
      sha256: encrypted.sha256,
      width: thumbnail.width,
      height: thumbnail.height,
    };
  } catch (error) {
    console.warn('Could not prepare the link preview picture', error);
    return null;
  }
}

/** The card that goes inside the message; a failed picture just leaves it out, and with nothing to show there is no card. */
export async function prepareLinkPreview(
  data: LinkPreviewData,
  upload: BlobUploader,
): Promise<LinkPreviewRef | undefined> {
  const title = cleanText(data.title, 200);
  const description = cleanText(data.description, 300);
  const siteName = cleanText(data.siteName, 100);
  const thumb = data.image ? await uploadThumb(data.image, upload) : null;
  if (!title && !thumb) return undefined;

  return {
    url: data.url,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(siteName ? { siteName } : {}),
    ...(thumb ? { thumb } : {}),
  };
}
