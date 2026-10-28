const FLAG = "gachahub:chat-timing";

/** Whether timing lines are printed: off unless this browser sets `localStorage["gachahub:chat-timing"] = "1"`. */
export function timingEnabled() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

/** Prints one timing line to the console when timing is switched on; for finding where a slow send or a late arrival loses its time. */
export function logTiming(event: string, details: Record<string, unknown> = {}) {
  if (!timingEnabled()) return;
  console.debug(`[chat timing] ${event}`, details);
}

/** Starts a stopwatch; calling the result prints the elapsed milliseconds with `event`. */
export function startTiming(event: string, details: Record<string, unknown> = {}) {
  const started = performance.now();
  return (extra: Record<string, unknown> = {}) => logTiming(event, { ms: Math.round(performance.now() - started), ...details, ...extra });
}
