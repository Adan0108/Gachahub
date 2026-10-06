import { Parser } from 'htmlparser2';
import { cleanText } from './clean-text';

export interface PageMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  /** Absolute http(s) URL of the page's own preview image. */
  imageUrl?: string;
}

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;
const MAX_SITE_NAME = 100;
const MAX_IMAGE_URL = 2048;

function first(
  meta: Map<string, string>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = meta.get(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function absoluteHttpUrl(
  value: string | undefined,
  base: URL,
): string | undefined {
  if (!value || value.length > MAX_IMAGE_URL) return undefined;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** What a page says about itself in its <head>: Open Graph, then Twitter cards, then plain tags; nothing is run or fetched. */
export function parseHeadMetadata(html: string, baseUrl: URL): PageMetadata {
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);

  const meta = new Map<string, string>();
  let titleTag = '';
  let inTitle = false;
  let seenTitle = false;

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === 'title' && !seenTitle) {
          inTitle = true;
          seenTitle = true;
        } else if (name === 'meta') {
          const key = (
            attributes.property ??
            attributes.name ??
            ''
          ).toLowerCase();
          const content = attributes.content;
          if (key && content !== undefined && !meta.has(key))
            meta.set(key, content);
        }
      },
      ontext(text) {
        if (inTitle) titleTag += text;
      },
      onclosetag(name) {
        if (name === 'title') inTitle = false;
      },
    },
    { decodeEntities: true },
  );
  parser.write(head);
  parser.end();

  return {
    title: cleanText(
      first(meta, 'og:title', 'twitter:title') ?? titleTag,
      MAX_TITLE,
    ),
    description: cleanText(
      first(meta, 'og:description', 'twitter:description', 'description'),
      MAX_DESCRIPTION,
    ),
    siteName: cleanText(first(meta, 'og:site_name'), MAX_SITE_NAME),
    imageUrl: absoluteHttpUrl(
      first(
        meta,
        'og:image:secure_url',
        'og:image',
        'twitter:image',
        'twitter:image:src',
      ),
      baseUrl,
    ),
  };
}
