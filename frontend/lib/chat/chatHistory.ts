export interface HistoryMessage {
  id: string;
  createdAt: string;
}

/**
 * Which messages left the end of the newest-messages window since the last poll and belong in
 * already-loaded older history.
 *
 * A deleted message stays in the window as a tombstone (findMessages returns DELETED rows), and a
 * pushed delete marks the cached copy first (useChatSocket), so what falls out is already marked.
 * These checks keep anything missing for another reason from being rescued: a window that didn't
 * stay full lost nothing off its end, and a message that fell off the end is older than everything
 * still in the window. Still missed: a delete this device never heard about, landing in the same
 * poll as enough new messages to push its tombstone out, moves the old copy to older history.
 */
export function messagesFallenOutOfWindow<Message extends HistoryMessage>(
  previous: readonly Message[],
  latest: readonly Message[],
): Message[] {
  if (latest.length < previous.length) return [];

  const oldestKeptCreatedAt = latest[0]?.createdAt;
  if (oldestKeptCreatedAt === undefined) return [];

  const currentIds = new Set(latest.map((message) => message.id));
  return previous.filter(
    (message) => !currentIds.has(message.id) && message.createdAt < oldestKeptCreatedAt,
  );
}
