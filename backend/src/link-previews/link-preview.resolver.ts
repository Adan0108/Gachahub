import { Injectable } from '@nestjs/common';
import type { LinkPreview, LinkPreviewImage } from './link-preview.types';
import { parseHeadMetadata } from './metadata/head-parser';
import { sniffImageMime } from './metadata/image-sniff';
import { oembedRequestUrl, parseOembed } from './metadata/oembed';
import { SafeFetcher } from './safe-fetcher';

const HTML_LIMIT = 512 * 1024;
const JSON_LIMIT = 100 * 1024;
const IMAGE_LIMIT = 1_000_000;

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const JSON_TYPES = new Set(['application/json', 'text/json']);
// A CDN often serves pictures as generic bytes; the real format is read from the bytes themselves.
const IMAGE_FALLBACK_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);

/** The link leads somewhere with nothing to show: no title and no picture. */
export class PreviewUnavailableError extends Error {}

interface Found {
  finalUrl: URL;
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  /** Set when the link itself is a picture. */
  image?: LinkPreviewImage;
}

const isImageType = (type: string) =>
  type.startsWith('image/') || IMAGE_FALLBACK_TYPES.has(type);

/** The charset the page declares near its top, for pages that do not say in their headers. */
function sniffCharset(bytes: Buffer): string | undefined {
  const top = bytes.subarray(0, 2048).toString('latin1');
  return /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_\-:.]+)/i
    .exec(top)?.[1]
    ?.toLowerCase();
}

function decode(bytes: Buffer, charset: string | undefined): string {
  try {
    return new TextDecoder(charset ?? sniffCharset(bytes) ?? 'utf-8').decode(
      bytes,
    );
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Works out what to show for a link: the site's own oEmbed answer, a picture, or what the page says about itself. */
@Injectable()
export class LinkPreviewResolver {
  constructor(private readonly fetcher: SafeFetcher) {}

  async resolve(url: URL): Promise<LinkPreview> {
    const found = (await this.fromOembed(url)) ?? (await this.fromPage(url));

    const image =
      found.image ??
      (found.imageUrl ? await this.fetchImage(found.imageUrl) : null);
    if (!found.title && !image) throw new PreviewUnavailableError();

    const domain = url.hostname;
    return {
      url: url.href,
      domain,
      resolvedDomain:
        found.finalUrl.hostname !== domain ? found.finalUrl.hostname : null,
      title: found.title ?? null,
      description: found.description ?? null,
      siteName: found.siteName ?? null,
      image,
    };
  }

  /** Null when the site is not one we ask, or it did not give a usable answer; the page itself is the fallback. */
  private async fromOembed(url: URL): Promise<Found | null> {
    const request = oembedRequestUrl(url);
    if (!request) return null;

    try {
      const response = await this.fetcher.fetch(request, {
        accept: 'application/json',
        limitFor: (type) => (JSON_TYPES.has(type) ? JSON_LIMIT : null),
      });
      const info = parseOembed(
        JSON.parse(response.bytes.toString('utf8')) as unknown,
      );
      if (!info.title) return null;

      return {
        finalUrl: url,
        title: info.title,
        description: info.authorName,
        siteName: info.providerName,
        imageUrl: info.thumbnailUrl,
      };
    } catch {
      return null;
    }
  }

  private async fromPage(url: URL): Promise<Found> {
    const page = await this.fetcher.fetch(url.href, {
      accept: 'text/html,application/xhtml+xml,image/*;q=0.8',
      limitFor: (type) =>
        HTML_TYPES.has(type)
          ? HTML_LIMIT
          : type.startsWith('image/')
            ? IMAGE_LIMIT
            : null,
      truncate: true,
    });

    if (page.contentType.startsWith('image/')) {
      const mime = sniffImageMime(page.bytes);
      if (!mime || page.truncated) throw new PreviewUnavailableError();
      return {
        finalUrl: page.url,
        image: { mime, data: page.bytes.toString('base64') },
      };
    }

    const metadata = parseHeadMetadata(
      decode(page.bytes, page.charset),
      page.url,
    );
    return { finalUrl: page.url, ...metadata };
  }

  /** A page's picture is a nicety: any trouble getting it just means a card without one. */
  private async fetchImage(imageUrl: string): Promise<LinkPreviewImage | null> {
    try {
      const response = await this.fetcher.fetch(imageUrl, {
        accept: 'image/*',
        limitFor: (type) => (isImageType(type) ? IMAGE_LIMIT : null),
      });
      const mime = sniffImageMime(response.bytes);
      return mime ? { mime, data: response.bytes.toString('base64') } : null;
    } catch {
      return null;
    }
  }
}
