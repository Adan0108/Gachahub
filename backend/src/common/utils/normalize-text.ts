/**
 * Trims optional free-text input and treats a whitespace-only value as
 * absent - otherwise "     " (or 1000 spaces, right up against a field's
 * MaxLength) validates and gets stored. For optional fields only: required
 * text like a post's title/content is trimmed inline where it's used, since
 * "empty" is a validation error there, not a value to drop.
 */
export function normalizeText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
