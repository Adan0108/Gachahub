import type { SearchHit } from './messageSearchIndex';

interface ThreadMessage {
  id: string;
  senderId: string;
  createdAt: string;
  status?: string;
}

export interface ThreadSearchResult {
  messageId: string;
  senderId: string;
  createdAt: string;
  /** Epoch milliseconds of createdAt, for ordering. */
  sentAt: number;
  /** The searchable text; the snippet is built from it only for the rows actually shown. */
  text: string;
}

export interface ThreadSearchResults {
  /** Newest first. */
  results: ThreadSearchResult[];
  /** Matches in messages this thread has not loaded, so their time and sender are not known yet. */
  olderCount: number;
}

/**
 * Turns the index's hits for one conversation into rows: only messages the thread knows about
 * (sender, time, not unsent, not hidden by you) become rows, the rest are counted as older.
 */
export function resolveThreadHits(
  hits: SearchHit[],
  messagesById: Map<string, ThreadMessage>,
  hiddenMessageIds: Set<string>,
): ThreadSearchResults {
  const results: ThreadSearchResult[] = [];
  let olderCount = 0;

  for (const hit of hits) {
    const message = messagesById.get(hit.messageId);
    if (!message) {
      olderCount += 1;
      continue;
    }
    if (message.status === 'DELETED' || hiddenMessageIds.has(message.id)) continue;
    results.push({
      messageId: message.id,
      senderId: message.senderId,
      createdAt: message.createdAt,
      sentAt: Date.parse(message.createdAt) || 0,
      text: hit.text,
    });
  }

  results.sort((a, b) => b.sentAt - a.sentAt);
  return { results, olderCount };
}

/** A position wrapped into 0..length-1, so stepping past either end of a list loops round. */
export function wrapPosition(position: number, length: number): number {
  return ((position % length) + length) % length;
}
