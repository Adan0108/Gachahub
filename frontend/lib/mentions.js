import { USERNAME_PATTERN } from "./username";

// Same rule as backend/src/mentions/mention-parser.ts: `@` must not follow a word character.
const MENTION_CANDIDATE = /(?<![\w-])@([A-Za-z0-9_-]+)/g;

/** Every valid-looking `@handle` in the text, with its character range. */
export function findMentions(text) {
  const mentions = [];

  for (const match of text.matchAll(MENTION_CANDIDATE)) {
    const handle = match[1].replace(/[_-]+$/, "");
    if (!USERNAME_PATTERN.test(handle)) continue;

    mentions.push({ start: match.index, end: match.index + 1 + handle.length, handle });
  }

  return mentions;
}

/** The mention the caret sits right after, if any. */
export function activeMention(text, caret) {
  return findMentions(text).find((mention) => mention.end === caret) ?? null;
}

/** Splits text into plain and mention parts; only handles in `usernames` (lowercase Set) count as mentions. */
export function splitMentions(text, usernames) {
  const parts = [];
  let cursor = 0;

  for (const mention of findMentions(text)) {
    if (!usernames.has(mention.handle.toLowerCase())) continue;

    if (mention.start > cursor) parts.push({ text: text.slice(cursor, mention.start) });
    parts.push({ text: text.slice(mention.start, mention.end), mention: true });
    cursor = mention.end;
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
