/** Shortest query worth searching messages for; one letter would match nearly everything. */
export const MIN_SEARCH_CHARS = 2;

// Letters that have no accent form to strip, but people type without the stroke.
const STROKE_LETTERS: Record<string, string> = { đ: 'd', ø: 'o', ł: 'l' };

/** One character, lower-cased with accents removed ("É" -> "e", "Đ" -> "d"). */
export function foldChar(char: string): string {
  return char
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[đøł]/g, (letter) => STROKE_LETTERS[letter] ?? letter);
}

/** The form text is compared in: case and accents ignored. Fold each side the same way, then compare. */
export function foldForSearch(text: string): string {
  let folded = '';
  for (const char of text) folded += foldChar(char);
  return folded;
}

/** The distinct, folded words of a query; a message must contain every one. Empty when there is nothing to search for. */
export function parseSearchQuery(query: string): string[] {
  return [...new Set(foldForSearch(query).split(/\s+/).filter(Boolean))];
}

export function matchesAllTerms(foldedText: string, terms: string[]): boolean {
  return terms.length > 0 && terms.every((term) => foldedText.includes(term));
}
