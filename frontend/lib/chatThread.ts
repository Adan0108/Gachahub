import type { MembershipEvent } from './mls/sync/membershipEvents';

interface ThreadMessage {
  id: string;
  senderId?: string;
  createdAt?: string;
  contentType?: string;
}

type DecryptState = { status: 'pending' | 'ok' | 'unavailable' } | undefined;

export type ThreadItem<M extends ThreadMessage = ThreadMessage> =
  | { kind: 'history-banner' }
  | { kind: 'timestamp'; at: number }
  | {
      kind: 'message';
      message: M;
      index: number;
      gapBefore: boolean;
      /** Stacked right under the same sender's last bubble, tight and un-labelled. */
      groupedWithPrevious: boolean;
      /** Another bubble from the same sender follows immediately, so this one keeps the avatar/name hidden. */
      groupedWithNext: boolean;
    }
  | { kind: 'event'; event: MembershipEvent };

/** A gap this long gets its own timestamp divider. */
export const TIMESTAMP_DIVIDER_GAP_MS = 45 * 60 * 1000;
/** A shorter gap gets no divider, just a bit of extra breathing room. */
export const MESSAGE_GROUP_GAP_MS = 25 * 60 * 1000;

/** Leading messages this device never could read: they predate it joining, so one banner covers them. */
function leadingUnreadableIds(
  messages: ThreadMessage[],
  decrypted: Record<string, DecryptState>,
): Set<string> {
  const hidden = new Set<string>();
  for (const message of messages) {
    if (message.contentType === 'SYSTEM') continue;
    const status = decrypted[message.id]?.status;
    if (status === 'ok') break;
    if (status === 'unavailable') hidden.add(message.id);
  }
  return hidden;
}

/** The thread's rows in order: history banner, then messages with membership events sorted by server time (events first on ties). */
export function buildThreadItems<M extends ThreadMessage>(input: {
  messages: M[];
  decrypted: Record<string, DecryptState>;
  events: MembershipEvent[];
  collapseLeading: boolean;
}): ThreadItem<M>[] {
  const { messages, decrypted, events, collapseLeading } = input;
  const hidden = collapseLeading ? leadingUnreadableIds(messages, decrypted) : new Set<string>();
  const pendingEvents = [...events].sort((a, b) => a.at - b.at);

  const items: ThreadItem<M>[] = hidden.size > 0 ? [{ kind: 'history-banner' }] : [];
  let prevAt: number | undefined;
  messages.forEach((message, index) => {
    if (hidden.has(message.id)) return;
    const sentAt = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
    while (pendingEvents[0] && !Number.isNaN(sentAt) && pendingEvents[0].at <= sentAt) {
      items.push({ kind: 'event', event: pendingEvents.shift()! });
    }
    const gap = Number.isNaN(sentAt) ? 0 : (prevAt === undefined ? Infinity : sentAt - prevAt);
    const showDivider = gap >= TIMESTAMP_DIVIDER_GAP_MS;
    // "Conversation started" reads as the thread's own opener; its divider sits under it, not above.
    const isConversationStart = message.contentType === 'SYSTEM';
    if (showDivider && !isConversationStart) items.push({ kind: 'timestamp', at: sentAt });
    items.push({
      kind: 'message',
      message,
      index,
      gapBefore: !showDivider && gap >= MESSAGE_GROUP_GAP_MS,
      groupedWithPrevious: false,
      groupedWithNext: false,
    });
    if (showDivider && isConversationStart) items.push({ kind: 'timestamp', at: sentAt });
    if (!Number.isNaN(sentAt)) prevAt = sentAt;
  });
  return withGrouping([...items, ...pendingEvents.map((event) => ({ kind: 'event' as const, event }))]);
}

/** Two consecutive bubbles from the same sender, close enough in time and with nothing else between them, stack tight with one shared avatar/name. */
function withGrouping<M extends ThreadMessage>(rawItems: ThreadItem<M>[]): ThreadItem<M>[] {
  const withPrevious = rawItems.map((item, i) => {
    if (item.kind !== 'message') return item;
    const prev = rawItems[i - 1];
    const groupedWithPrevious =
      prev?.kind === 'message' &&
      prev.message.senderId === item.message.senderId &&
      item.message.contentType !== 'SYSTEM' &&
      prev.message.contentType !== 'SYSTEM' &&
      !item.gapBefore;
    return { ...item, groupedWithPrevious };
  });
  return withPrevious.map((item, i) => {
    if (item.kind !== 'message') return item;
    const next = withPrevious[i + 1];
    const groupedWithNext = next?.kind === 'message' && next.groupedWithPrevious;
    return { ...item, groupedWithNext };
  });
}

/** A DM's own leaf being added/removed isn't "joining a group" for either side; only a group chat shows those. */
export function eventsForDisplay(events: MembershipEvent[], isGroup: boolean): MembershipEvent[] {
  return isGroup ? events : events.filter((event) => event.kind === 'device-added');
}

const pad2 = (value: number): string => String(value).padStart(2, '0');
const timeLabel = (date: Date): string => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
const startOfDay = (ms: number): number => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** Messenger-style divider text: time only today, weekday name within the past week, full date otherwise. */
export function messageDividerLabel(at: number, now: number, locale?: string): string {
  const date = new Date(at);
  const diffDays = Math.max(0, Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000));
  const time = timeLabel(date);
  if (diffDays === 0) return time;
  if (diffDays <= 6) return `${date.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
  return `${date.getDate()} ${date.toLocaleDateString(locale, { month: 'short' })} ${date.getFullYear()}, ${time}`;
}

/** Full, unambiguous timestamp for a hover tooltip. */
export function messageFullTimestamp(at: number, locale?: string): string {
  const date = new Date(at);
  return `${date.getDate()} ${date.toLocaleDateString(locale, { month: 'long' })} ${date.getFullYear()}, ${timeLabel(date)}`;
}

/** One system line for an event; `name` is the person's display name, or undefined when unknown. */
export function membershipEventText(
  event: MembershipEvent,
  name: string | undefined,
  isSelf: boolean,
): string {
  const who = isSelf ? 'You' : name || 'A member';
  if (event.kind === 'joined') return `${who} ${isSelf ? 'were added to' : 'joined'} the group`;
  if (event.kind === 'left') return `${who} left or ${isSelf ? 'were' : 'was'} removed from the group`;
  return `${who} signed in on a new device`;
}

/** Stable React key for a thread row. */
export function threadItemKey(item: ThreadItem): string {
  if (item.kind === 'history-banner') return 'history-banner';
  if (item.kind === 'timestamp') return `timestamp-${item.at}`;
  return item.kind === 'event' ? item.event.id : item.message.id;
}

/** Marks a message deleted in a cached list, so unsending shows at once instead of waiting on a refetch. */
export function withOptimisticDelete<M extends { id: string; status?: string }>(
  messages: M[],
  messageId: string,
): M[] {
  return messages.map((message) =>
    message.id === messageId ? { ...message, status: 'DELETED' } : message,
  );
}

/** How "X replied to ___" names the original sender, from the viewer's own point of view. */
export function replyOriginalSenderLabel(
  replierSenderId: string,
  originalSenderId: string | undefined,
  viewerId: string | undefined,
  originalSenderName: string | undefined,
): string {
  if (!originalSenderId) return 'a message';
  if (originalSenderId === replierSenderId) return replierSenderId === viewerId ? 'yourself' : 'themself';
  if (originalSenderId === viewerId) return 'You';
  return originalSenderName || 'a message';
}

export interface ReadableNeighbors {
  before: boolean[];
  after: boolean[];
}

/** One O(n) pass over the thread: for each index, whether a readable message appears before/after it. */
export function readableNeighbors(
  messages: ThreadMessage[],
  decrypted: Record<string, DecryptState>,
): ReadableNeighbors {
  const before: boolean[] = new Array(messages.length);
  const after: boolean[] = new Array(messages.length);
  let seen = false;
  for (let i = 0; i < messages.length; i += 1) {
    before[i] = seen;
    if (decrypted[messages[i]!.id]?.status === 'ok') seen = true;
  }
  seen = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    after[i] = seen;
    if (decrypted[messages[i]!.id]?.status === 'ok') seen = true;
  }
  return { before, after };
}

/** An undecryptable message bounded on both sides by readable ones was likely sent during a membership gap. */
export function wasLikelySentDuringAbsence(neighbors: ReadableNeighbors, index: number): boolean {
  return neighbors.before[index] === true && neighbors.after[index] === true;
}
