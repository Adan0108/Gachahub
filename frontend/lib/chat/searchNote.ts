import { indexingLabel, type IndexSnapshot } from './messageSearchIndex';
import { MIN_SEARCH_CHARS } from './searchFolding';

interface SearchNoteInput {
  /** What is in the box right now. */
  typed: string;
  /** What the shown results are for. */
  submitted: string;
  indexSnapshot: Pick<IndexSnapshot, 'status' | 'indexed' | 'total'>;
  resultCount: number;
  /** Position of the result you are on, or -1. */
  activePosition: number;
}

/** The one line under the search box saying where the search stands; empty when there is nothing to say. */
export function searchNote({ typed, submitted, indexSnapshot, resultCount, activePosition }: SearchNoteInput): string {
  if (typed !== submitted) {
    return typed.length < MIN_SEARCH_CHARS
      ? `Type at least ${MIN_SEARCH_CHARS} letters, then press Enter.`
      : 'Press Enter to search.';
  }
  if (submitted.length < MIN_SEARCH_CHARS) return submitted ? `Type at least ${MIN_SEARCH_CHARS} letters.` : '';
  if (indexSnapshot.status !== 'ready') return indexingLabel(indexSnapshot);
  if (resultCount === 0) return 'No messages match.';
  return `${activePosition >= 0 ? `${activePosition + 1} of ` : ''}${resultCount} ${resultCount === 1 ? 'result' : 'results'}`;
}
