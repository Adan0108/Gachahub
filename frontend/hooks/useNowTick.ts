"use client";

import { useEffect, useState } from "react";

/** Re-renders on an interval so time-relative UI (e.g. message timestamp dividers) stays current. */
export function useNowTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
