const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60_000;

/** How long to wait before retrying messages that couldn't be decrypted for want of a commit sync: doubles from 5s, capped at 1 minute. */
export function nextRetryDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}
