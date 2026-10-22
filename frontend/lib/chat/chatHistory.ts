export interface HistoryMessage {
  id: string;
  createdAt: string;
}

/**
 * The one message order everywhere: by time, then by id, as the server pages history. Two
 * messages sent in the same millisecond keep the same order however they arrived.
 */
export function compareMessages(a: HistoryMessage, b: HistoryMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Which messages left the end of the newest-messages window since the last poll and belong in
 * already-loaded older history.
 *
 * A deleted message stays in the window as a tombstone (findMessages returns DELETED rows), and a
 * pushed delete marks the cached copy first (useChatSocket), so nothing goes missing because it
 * was deleted. Anything that was in the window and is now before its oldest message fell off the
 * end, including when the window shrank: live pushes can grow it past a page, and the next poll
 * brings it back to one page.
 */
export function messagesFallenOutOfWindow<Message extends HistoryMessage>(
  previous: readonly Message[],
  latest: readonly Message[],
): Message[] {
  const oldestKept = latest[0];
  if (oldestKept === undefined) return [];

  const currentIds = new Set(latest.map((message) => message.id));
  return previous.filter(
    (message) => !currentIds.has(message.id) && compareMessages(message, oldestKept) < 0,
  );
}
