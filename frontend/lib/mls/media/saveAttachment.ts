import { safeFileName } from './attachmentView';
import { loadAttachmentBlob, type AttachmentSource } from './attachmentLoader';

export const REVOKE_DELAY_MS = 30_000;

/** Decrypts (or reuses the cached plaintext) and hands it to the browser as a download. */
export async function saveAttachment(source: AttachmentSource, name: string): Promise<void> {
  const blob = await loadAttachmentBlob(source);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(name);
  document.body.append(link);
  link.click();
  link.remove();
  // browsers may read the blob lazily after the click; give the download time to start
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
