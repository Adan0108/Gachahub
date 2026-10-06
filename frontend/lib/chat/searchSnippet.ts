import { foldChar } from './searchFolding';

export interface TextRange {
  start: number;
  end: number;
}

/** A short excerpt around the first match; `highlights` are offsets into `text`. */
export interface Snippet {
  text: string;
  highlights: TextRange[];
}

const SNIPPET_RADIUS = 40;
const ELLIPSIS = '…';
const MARK = /\p{M}/u;

/** Folded text plus, for each folded character, where it started in the original. */
function foldWithOffsets(text: string): { folded: string; starts: number[] } {
  let folded = '';
  const starts: number[] = [];
  let index = 0;
  for (const char of text) {
    const piece = foldChar(char);
    for (let i = 0; i < piece.length; i += 1) starts.push(index);
    folded += piece;
    index += char.length;
  }
  return { folded, starts };
}

function toOriginalRange(text: string, starts: number[], from: number, to: number): TextRange {
  const lastStart = starts[to - 1] ?? text.length;
  let end = lastStart + String.fromCodePoint(text.codePointAt(lastStart) ?? 0).length;
  // an accent typed as a separate mark belongs to the letter it follows
  while (end < text.length) {
    const next = String.fromCodePoint(text.codePointAt(end) ?? 0);
    if (!MARK.test(next)) break;
    end += next.length;
  }
  return { start: starts[from] ?? 0, end };
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  const merged: TextRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** Where each folded term occurs in the original text (accents and case ignored), sorted and merged. */
export function highlightRanges(text: string, terms: string[]): TextRange[] {
  const { folded, starts } = foldWithOffsets(text);
  const ranges: TextRange[] = [];
  for (const term of terms) {
    if (!term) continue;
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      ranges.push(toOriginalRange(text, starts, at, at + term.length));
    }
  }
  return mergeRanges(ranges);
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** One line around the first match, with "…" where it was cut and the matches marked. */
export function buildSnippet(text: string, terms: string[], radius = SNIPPET_RADIUS): Snippet {
  const flat = text.replace(/\s+/g, ' ').trim();
  const ranges = highlightRanges(flat, terms);
  const first = ranges[0];

  let start = first ? Math.max(0, first.start - radius) : 0;
  let end = first ? Math.min(flat.length, first.end + radius) : Math.min(flat.length, radius * 2);
  if (start > 0 && isLowSurrogate(flat.charCodeAt(start))) start += 1;
  if (end < flat.length && isLowSurrogate(flat.charCodeAt(end))) end -= 1;
  while (start < end && flat[start] === ' ') start += 1;
  while (end > start && flat[end - 1] === ' ') end -= 1;

  const prefix = start > 0 ? ELLIPSIS : '';
  const suffix = end < flat.length ? ELLIPSIS : '';
  const shift = prefix.length - start;
  const highlights = ranges
    .map((range) => ({ start: Math.max(range.start, start), end: Math.min(range.end, end) }))
    .filter((range) => range.end > range.start)
    .map((range) => ({ start: range.start + shift, end: range.end + shift }));

  return { text: prefix + flat.slice(start, end) + suffix, highlights };
}
