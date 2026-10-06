import { cleanText } from './clean-text';

/** Sites asked through their own oEmbed endpoint; fixed here so a page cannot choose where the server goes next. */
const PROVIDERS: Array<{ hosts: string[]; endpoint: string }> = [
  {
    hosts: [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
    ],
    endpoint: 'https://www.youtube.com/oembed',
  },
];

export interface OembedInfo {
  title?: string;
  /** Who made it, such as a channel name. */
  authorName?: string;
  providerName?: string;
  thumbnailUrl?: string;
}

/** The provider's oEmbed address for a link, or null when the site is not one we ask. */
export function oembedRequestUrl(url: URL): string | null {
  const provider = PROVIDERS.find(({ hosts }) =>
    hosts.includes(url.hostname.toLowerCase()),
  );
  if (!provider) return null;

  const request = new URL(provider.endpoint);
  request.searchParams.set('url', url.href);
  request.searchParams.set('format', 'json');
  return request.href;
}

const asString = (value: unknown) =>
  typeof value === 'string' ? value : undefined;

function httpUrl(value: unknown): string | undefined {
  const text = asString(value);
  if (!text || text.length > 2048) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** The few oEmbed fields we use, from whatever JSON came back. */
export function parseOembed(json: unknown): OembedInfo {
  if (typeof json !== 'object' || json === null) return {};
  const data = json as Record<string, unknown>;

  return {
    title: cleanText(asString(data.title), 200),
    authorName: cleanText(asString(data.author_name), 100),
    providerName: cleanText(asString(data.provider_name), 100),
    thumbnailUrl: httpUrl(data.thumbnail_url),
  };
}
