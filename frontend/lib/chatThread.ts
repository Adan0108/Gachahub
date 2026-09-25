import type { MembershipEvent } from './mls/sync/membershipEvents';

interface ThreadMessage {
  id: string;
  createdAt?: string;
  contentType?: string;
}

type DecryptState = { status: 'pending' | 'ok' | 'unavailable' } | undefined;

export type ThreadItem<M extends ThreadMessage = ThreadMessage> =
  | { kind: 'history-banner' }
  | { kind: 'message'; message: M; index: number }
  | { kind: 'event'; event: MembershipEvent };

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
  messages.forEach((message, index) => {
    if (hidden.has(message.id)) return;
    const sentAt = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
    while (pendingEvents[0] && !Number.isNaN(sentAt) && pendingEvents[0].at <= sentAt) {
      items.push({ kind: 'event', event: pendingEvents.shift()! });
    }
    items.push({ kind: 'message', message, index });
  });
  return [...items, ...pendingEvents.map((event) => ({ kind: 'event' as const, event }))];
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
  return item.kind === 'event' ? item.event.id : item.message.id;
}

/** An undecryptable message bounded on both sides by readable ones was likely sent during a membership gap. */
export function wasLikelySentDuringAbsence(
  messages: ThreadMessage[],
  decrypted: Record<string, DecryptState>,
  index: number,
): boolean {
  const isOk = (message: ThreadMessage) => decrypted[message.id]?.status === 'ok';
  return messages.slice(0, index).some(isOk) && messages.slice(index + 1).some(isOk);
}
