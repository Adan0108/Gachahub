import { USERNAME_PATTERN } from '../users/dto/complete-onboarding.dto';

export const MAX_MENTIONS_PER_TEXT = 10;

// `@` must not follow a word character, so emails like bob@mail.com are not mentions.
const MENTION_CANDIDATE = /(?<![\w-])@([A-Za-z0-9_-]+)/g;

/**
 * Distinct, case-insensitive `@handle`s in the text, capped. Like Discord/GitHub, the whole run of
 * handle characters is one candidate: `@bob-smith` mentions `bob-smith` (never `bob`), and an
 * invalid run such as `@bob--x` mentions nobody. Only trailing separators are dropped (`@bob_`).
 */
export function extractMentionHandles(text: string): string[] {
  const seen = new Map<string, string>();

  for (const match of text.matchAll(MENTION_CANDIDATE)) {
    const handle = match[1].replace(/[_-]+$/, '');

    if (USERNAME_PATTERN.test(handle) && !seen.has(handle.toLowerCase())) {
      seen.set(handle.toLowerCase(), handle);

      if (seen.size === MAX_MENTIONS_PER_TEXT) {
        break;
      }
    }
  }

  return [...seen.values()];
}
