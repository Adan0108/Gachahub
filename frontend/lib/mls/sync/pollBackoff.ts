export const MAX_POLL_DELAY_MS = 60_000;

/** Base interval while healthy; doubles per consecutive error up to 60s, jittered to 75-100% once failing so tabs don't retry in lockstep. */
export function pollDelayMs(
  baseMs: number,
  consecutiveErrors: number,
  random: () => number = Math.random,
): number {
  if (consecutiveErrors <= 0) return baseMs;
  const capped = Math.min(baseMs * 2 ** consecutiveErrors, MAX_POLL_DELAY_MS);
  return capped * (0.75 + random() * 0.25);
}
