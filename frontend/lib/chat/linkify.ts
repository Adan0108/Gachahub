export interface LinkSpan {
  start: number;
  end: number;
  /** The link exactly as written in the text. */
  text: string;
  /** Where it goes: always http(s), with a scheme added to a bare www address. */
  href: string;
}

export type TextSegment = { text: string; href?: undefined } | { text: string; href: string };

const MAX_LINK_LENGTH = 2048;
// Not after a word character or one of these, so "me@www.example.com" and "xhttp://a" are left alone
const CANDIDATE = /(?<![\w@./-])(?:https?:\/\/|www\.)[^\s<>]+/gi;
const SENTENCE_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);
const OPENER_OF: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

const count = (text: string, char: string) => text.split(char).length - 1;

/** Drops what follows a link in a sentence: its full stop, comma or a closing bracket that has no opener inside the link. */
function withoutTrailingPunctuation(candidate: string): string {
  let end = candidate.length;
  while (end > 0) {
    const last = candidate[end - 1]!;
    const opener = OPENER_OF[last];
    const unmatchedCloser = opener && count(candidate.slice(0, end), last) > count(candidate.slice(0, end), opener);
    if (!SENTENCE_PUNCTUATION.has(last) && !unmatchedCloser) break;
    end -= 1;
  }
  return candidate.slice(0, end);
}

function hrefFor(text: string): string | null {
  if (text.length === 0 || text.length > MAX_LINK_LENGTH) return null;

  try {
    const url = new URL(/^www\./i.test(text) ? `https://${text}` : text);
    const usable =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      // a name with credentials in it is how "paypal.com@evil.example" gets disguised, so it is never made clickable
      url.username === '' &&
      url.password === '' &&
      url.hostname.includes('.') &&
      !url.hostname.startsWith('.');
    return usable ? url.href : null;
  } catch {
    return null;
  }
}

/** The web links in a piece of text, in order. */
export function findLinks(text: string): LinkSpan[] {
  const spans: LinkSpan[] = [];

  for (const match of text.matchAll(CANDIDATE)) {
    const linkText = withoutTrailingPunctuation(match[0]);
    const href = hrefFor(linkText);
    if (href) {
      spans.push({ start: match.index, end: match.index + linkText.length, text: linkText, href });
    }
  }

  return spans;
}

/** The text cut into plain pieces and links, so it can be shown with real anchors and nothing treated as markup. */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let position = 0;

  for (const link of findLinks(text)) {
    if (link.start > position) segments.push({ text: text.slice(position, link.start) });
    segments.push({ text: link.text, href: link.href });
    position = link.end;
  }
  if (position < text.length) segments.push({ text: text.slice(position) });

  return segments;
}

/** The same address with no fragment, for telling whether two links are the same page. */
export function withoutFragment(href: string): string | null {
  try {
    const url = new URL(href);
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
