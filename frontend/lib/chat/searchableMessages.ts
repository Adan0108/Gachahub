import { envelopeView } from '../mls/media/attachmentView';
import type { DecryptedMessage } from '../mls/storage/messagePlaintextStore';
import { foldForSearch, matchesAllTerms, parseSearchQuery } from './searchFolding';

export interface SearchHit {
  messageId: string;
  conversationId: string;
  /** The searchable text of the message; pass it to buildSnippet(text, terms) to show a match. */
  text: string;
}

export interface SearchResult {
  /** The folded query words, for buildSnippet / highlightRanges. */
  terms: string[];
  /** In no particular order; the caller sorts them (e.g. by message time). */
  hits: SearchHit[];
}

/** The part of the index the search screens use. */
export interface MessageSearcher {
  search(query: string, options?: { conversationId?: string }): SearchResult;
}

interface Entry extends SearchHit {
  folded: string;
}

/** What search looks at in a message: its text, or an attachment's caption and file names. Null when the envelope cannot be read. */
export function searchableText(envelope: unknown): string | null {
  const view = envelopeView(envelope);
  if (!view) return null;
  switch (view.kind) {
    case 'text':
      return view.text;
    case 'attachment':
      return [view.caption, ...view.files.map((file) => file.name)].filter(Boolean).join(' ');
    default: {
      const unhandled: never = view;
      return unhandled;
    }
  }
}

/** The searchable messages themselves: what to match, and nothing about how they get filled or watched. */
export class SearchableMessages implements MessageSearcher {
  private readonly entries = new Map<string, Entry>();

  get size(): number {
    return this.entries.size;
  }

  has(messageId: string): boolean {
    return this.entries.has(messageId);
  }

  delete(messageId: string): boolean {
    return this.entries.delete(messageId);
  }

  clear(): void {
    this.entries.clear();
  }

  put(message: DecryptedMessage): void {
    const text = searchableText(message.envelope);
    // an envelope that cannot be read leaves what is already indexed for it alone
    if (text === null) return;
    if (!text) {
      this.entries.delete(message.messageId);
      return;
    }
    this.entries.set(message.messageId, {
      messageId: message.messageId,
      conversationId: message.conversationId,
      text,
      folded: foldForSearch(text),
    });
  }

  search(query: string, { conversationId }: { conversationId?: string } = {}): SearchResult {
    const terms = parseSearchQuery(query);
    const hits: SearchHit[] = [];
    if (terms.length === 0) return { terms, hits };

    for (const entry of this.entries.values()) {
      if (conversationId && entry.conversationId !== conversationId) continue;
      if (matchesAllTerms(entry.folded, terms)) {
        hits.push({ messageId: entry.messageId, conversationId: entry.conversationId, text: entry.text });
      }
    }
    return { terms, hits };
  }
}
