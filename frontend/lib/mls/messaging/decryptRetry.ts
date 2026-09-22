import { GroupStateUnavailableError, MembershipMismatchError } from '../contract/errors';

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60_000;

/** How long to wait before retrying messages that couldn't be decrypted for want of a commit sync: doubles from 5s, capped at 1 minute. */
export function nextRetryDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

/** Give up (mark unavailable) after this many timed retries. */
export const MAX_RETRY_ATTEMPTS = 5;

/**
 * Whether messages that failed to decrypt should wait for another try: only when catching up on commits
 * failed for a reason that can pass (the network), and only so many times. A group the client refused on
 * purpose (MembershipMismatchError) or has no copy of will not fix itself.
 */
export function shouldRetryDecrypt(syncError: unknown, attemptsSoFar: number): boolean {
  if (syncError === undefined || attemptsSoFar >= MAX_RETRY_ATTEMPTS) return false;

  return (
    !(syncError instanceof MembershipMismatchError) &&
    !(syncError instanceof GroupStateUnavailableError)
  );
}
