import type { ChatEmote, RawReaction } from "../chat/chatReactions";

export const COMMUNITY_MESSAGE_MAX_CHARS = 2000;
/** The counter only appears this close to the limit, so it does not nag while typing. */
export const COMMUNITY_COUNTER_FROM_CHARS = 1800;
/** Same window as the server: authors can edit for this long. */
export const COMMUNITY_EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Messages by one person closer together than this share one name and picture. */
export const COMMUNITY_GROUP_WINDOW_MS = 5 * 60 * 1000;

export type CommunityBadge = "ADMIN" | "MODERATOR";

/** One message of a community room as the server sends it; mirrors CommunityMessage in backend/src/community-chat/community-message.mapper.ts. */
export interface CommunityMessage {
  id: string;
  channelId: string;
  /** Null once removed, or when you have blocked the author. */
  content: string | null;
  deleted: boolean;
  /** You blocked this author: only the place of the message is kept. */
  blocked: boolean;
  createdAt: string;
  editedAt: string | null;
  author: { id: string; name: string; image: string | null; badge: CommunityBadge | null } | null;
  replyTo: {
    id: string;
    content: string | null;
    deleted: boolean;
    blocked: boolean;
    authorName: string | null;
  } | null;
  reactions: Array<RawReaction & { emote: ChatEmote | null }>;
}

export interface CommunityPage {
  /** Oldest first. */
  items: CommunityMessage[];
  /** Whether messages older than the first one remain. */
  hasMore: boolean;
}

/** The shape React Query keeps for an infinite list; the first page is the newest. */
export interface CommunityPagesData {
  pages: CommunityPage[];
  pageParams: unknown[];
}

/** Every loaded message, oldest first. */
export function messagesOf(data: CommunityPagesData | undefined): CommunityMessage[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((page) => page.items);
}

/** Where to load from to get the page above the oldest one loaded; undefined when the start has been reached. */
export function olderPageParam(lastPage: CommunityPage): string | undefined {
  return lastPage.hasMore ? lastPage.items[0]?.id : undefined;
}

/** Puts a message into the loaded list: replaces it when it is already there, otherwise adds it to the newest page in time order. */
export function upsertMessage(
  data: CommunityPagesData | undefined,
  message: CommunityMessage,
): CommunityPagesData | undefined {
  if (!data || data.pages.length === 0) return data;

  const known = data.pages.some((page) => page.items.some((item) => item.id === message.id));
  if (known) return patchMessage(data, message.id, () => message);

  const [newest, ...older] = data.pages;
  const items = [...newest!.items, message].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  return { ...data, pages: [{ ...newest!, items }, ...older] };
}

export function patchMessage(
  data: CommunityPagesData | undefined,
  messageId: string,
  update: (message: CommunityMessage) => CommunityMessage,
): CommunityPagesData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === messageId ? update(item) : item)),
    })),
  };
}

/** Whether this person can still edit this message. */
export function canEditCommunityMessage(
  message: CommunityMessage,
  userId: string | undefined,
  now: number,
): boolean {
  return (
    Boolean(userId) &&
    !message.deleted &&
    message.author?.id === userId &&
    now - Date.parse(message.createdAt) <= COMMUNITY_EDIT_WINDOW_MS
  );
}

export type CommunityRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "message"; key: string; message: CommunityMessage; showHeader: boolean };

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** "Today", "Yesterday", or the date. */
export function dayLabel(date: Date, now: Date, locale?: string): string {
  if (sameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

/** The room as rows: a divider when the day changes, and a name and picture only where a new run of messages by one person starts. */
export function buildRows(
  messages: CommunityMessage[],
  options: { now: Date; locale?: string },
): CommunityRow[] {
  const rows: CommunityRow[] = [];
  let previous: CommunityMessage | undefined;

  for (const message of messages) {
    const at = new Date(message.createdAt);
    const newDay = !previous || !sameDay(at, new Date(previous.createdAt));
    if (newDay) {
      rows.push({
        kind: "day",
        key: `day-${at.toDateString()}`,
        label: dayLabel(at, options.now, options.locale),
      });
    }

    const continues =
      !newDay &&
      previous !== undefined &&
      !previous.deleted &&
      !message.deleted &&
      !previous.blocked &&
      !message.blocked &&
      !message.replyTo &&
      previous.author !== null &&
      previous.author?.id === message.author?.id &&
      at.getTime() - Date.parse(previous.createdAt) <= COMMUNITY_GROUP_WINDOW_MS;

    rows.push({ kind: "message", key: message.id, message, showHeader: !continues });
    previous = message;
  }

  return rows;
}
