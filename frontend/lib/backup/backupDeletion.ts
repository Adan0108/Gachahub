import { RecoveryKeyError } from './backupKey';

const KEY_PROBLEMS: Record<string, string> = {
  characters: 'The recovery key can only contain the letters A-Z and the digits 2-7.',
  length: 'The recovery key is the wrong length. It has 8 groups of 8 characters.',
  checksum: 'That recovery key has a typo. Check it against your saved copy.',
};

/** Plain-language reason a typed recovery key failed; a 403 means it is well formed but not this backup's key. */
export function recoveryKeyMessage(error: unknown, fallback: string): string {
  if (error instanceof RecoveryKeyError) return KEY_PROBLEMS[error.problem]!;
  if ((error as { status?: number } | null)?.status === 403) {
    return 'That key does not match this backup.';
  }
  return fallback;
}

/** The scheduled deletion date for display, or null when none is scheduled or the value is unreadable. */
export function formatDeletionDate(iso: string | null | undefined, locale?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale, { dateStyle: 'long' });
}
