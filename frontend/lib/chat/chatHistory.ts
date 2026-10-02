export interface HistoryMessage {
  id: string;
  createdAt: string;
}

/**
 * Which messages left the end of the newest-messages window since the last poll and belong in
 * already-loaded older history.
 *
 * A message can also vanish from the window because it was deleted (findMessages only returns
 * SENT messages), and that must not be rescued or a delete silently undoes itself for anyone
 * with the conversation open. Two things tell the cases apart. A window that didn't stay full
 * lost nothing off its end, so anything missing was deleted - this is what covers short
 * conversations, where the window can't backfill. And a message that fell off the end is older
 * than everything still in the window. Neither catches a delete and a new arrival landing in the
 * same poll of the oldest message; that needs the API to return deleted messages as tombstones.
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
