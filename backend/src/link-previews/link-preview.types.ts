import type { PreviewImageMime } from './metadata/image-sniff';

export interface LinkPreviewImage {
  mime: PreviewImageMime;
  /** The picture itself, base64, so the sender's device can shrink, encrypt and attach it to the message. */
  data: string;
}

export interface LinkPreview {
  /** The link as asked about, normalised. */
  url: string;
  domain: string;
  /** Where the link really leads when it redirects somewhere else (a short link, say); otherwise null. */
  resolvedDomain: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: LinkPreviewImage | null;
}
