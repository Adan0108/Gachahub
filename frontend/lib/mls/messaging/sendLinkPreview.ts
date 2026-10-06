import { api } from '../../api';
import type { LinkPreviewRef } from '../contract/types';
import { prepareLinkPreview, type LinkPreviewData } from '../media/prepareLinkPreview';

/** Cards already prepared, by message, so a retry re-sends the same card without uploading its picture again. */
export type PreparedPreviews = Map<string, LinkPreviewRef | undefined>;

/** The card to send with a message, prepared once per message so a retry does not upload the picture again. */
export async function previewForSend(params: {
  preview: LinkPreviewData | undefined;
  clientMessageId: string;
  prepared: PreparedPreviews;
}): Promise<LinkPreviewRef | undefined> {
  const { preview, clientMessageId, prepared } = params;
  if (!preview) return undefined;
  if (prepared.has(clientMessageId)) return prepared.get(clientMessageId);

  const card = await prepareLinkPreview(preview, (blobs) => api.uploadChatBlobs(blobs));
  prepared.set(clientMessageId, card);
  return card;
}
