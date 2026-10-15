const MAX_EMOJI_LENGTH = 32;

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

// Everything an emoji sequence is made of: pictographs, skin tones, flag letters, joiners, selectors, keycaps and flag tags.
const EMOJI_PARTS =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|[\u{E0020}-\u{E007F}]|[0-9#*])+$/u;
const HAS_EMOJI_BASE =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]️?⃣/u;
const REGIONAL_INDICATOR = /\p{Regional_Indicator}/gu;

/**
 * True for exactly one emoji: a single glyph as a person sees it, whatever it is built from.
 * Judged on the structure rather than a list of known emoji, so one a newer phone sends is
 * not refused just because this server's Unicode data is older.
 */
export function isSingleEmoji(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMOJI_LENGTH) return false;
  if ([...graphemes.segment(value)].length !== 1) return false;
  if (!EMOJI_PARTS.test(value) || !HAS_EMOJI_BASE.test(value)) return false;

  // A flag is exactly two letters; one alone, or three, is not an emoji
  const flagLetters = value.match(REGIONAL_INDICATOR)?.length ?? 0;
  return flagLetters === 0 || flagLetters === 2;
}
