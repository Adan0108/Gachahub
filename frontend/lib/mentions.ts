import { USERNAME_PATTERN } from "./username";

// Same rule as backend/src/mentions/mention-parser.ts: `@` must not follow a word character.
const MENTION_CANDIDATE = /(?<![\w-])@([A-Za-z0-9_-]+)/g;

/** Every valid-looking `@handle` in the text, with its character range. */
export type MentionRange = { start: number; end: number; handle: string };
export type MentionPart = { text: string; mention?: true };

export function findMentions(text: string): MentionRange[] {
  const mentions: MentionRange[] = [];

  for (const match of text.matchAll(MENTION_CANDIDATE)) {
    const handle = match[1]?.replace(/[_-]+$/, "") ?? "";
    if (!USERNAME_PATTERN.test(handle)) continue;

    mentions.push({ start: match.index, end: match.index + 1 + handle.length, handle });
  }

  return mentions;
}

/** The `@word` being typed right before the caret (the word may still be empty or partial), or null. */
export function typingMention(text: string, caret: number) {
  const match = /(?<![\w-])@([A-Za-z0-9_-]{0,20})$/.exec(text.slice(0, caret));
  return match ? { start: match.index, end: caret, query: match[1] } : null;
}

/** The mention the caret sits right after, if any. */
export function activeMention(text: string, caret: number): MentionRange | null {
  return findMentions(text).find((mention) => mention.end === caret) ?? null;
}

/** Splits text into plain and mention parts; only handles in `usernames` (lowercase Set) count as mentions. */
export function splitMentions(text: string, usernames: ReadonlySet<string>): MentionPart[] {
  const parts: MentionPart[] = [];
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

/** Someone who can be @mentioned. */
export type MentionMember = {
  id: string;
  name?: string | null;
  username?: string | null;
  image?: string | null;
};

// Mirrors MAX_MENTIONS_PER_TEXT on the backend, which refuses a message naming more.
export const MAX_MENTIONS_PER_TEXT = 10;

/** People in `members` ({ id, name, username }) whose handle or name starts like `query`, for the @ list. */
export function matchMembers<M extends MentionMember>(members: M[], query: string, limit = 8): M[] {
  const needle = query.toLowerCase();
  return members
    .filter(
      (member) =>
        member.username &&
        (member.username.toLowerCase().startsWith(needle) ||
          member.name?.toLowerCase().startsWith(needle)),
    )
    .slice(0, limit);
}

/** Ids of the `members` an @handle in the text names, at most MAX_MENTIONS_PER_TEXT. */
export function mentionedIds(text: string, members: MentionMember[]): string[] {
  const idByHandle = new Map(members.map((member) => [member.username?.toLowerCase(), member.id]));
  const ids = findMentions(text).map((mention) => idByHandle.get(mention.handle.toLowerCase()));
  return [...new Set(ids.filter((id): id is string => Boolean(id)))].slice(
    0,
    MAX_MENTIONS_PER_TEXT,
  );
}
