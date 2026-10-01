/**
 * Manual reconnect schedule for a server-initiated socket disconnect (useChatSocket.js).
 * socket.io's own backoff+jitter only covers reconnects IT decided to attempt, not this one -
 * without a schedule of our own here, a fixed-interval retry would hammer the server on a fixed
 * cadence during an outage, with every open tab landing back at the same moment on recovery.
 */
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/** Give up reconnecting after this many consecutive failures - see reconnectDelayMs's docblock for why that's safe here. */
export const MAX_RECONNECT_ATTEMPTS = 10;

/** Doubles from 1s, capped at 30s, jittered to 50-100% of that so tabs don't retry in lockstep. */
export function reconnectDelayMs(attempt: number): number {
  const capped = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return capped * (0.5 + Math.random() * 0.5);
}
