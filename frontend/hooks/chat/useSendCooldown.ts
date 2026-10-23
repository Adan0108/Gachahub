"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SEND_LIMIT, SEND_WINDOW_MS } from "../../lib/chat/messageLimits";

const DEFAULT_RETRY_AFTER_SECONDS = 5;
// Hitting the limit waits this long; each time soon after doubles it, up to a minute;
// this long without hitting it starts over at the shortest cooldown.
const COOLDOWN_MS = 10_000;
const MAX_COOLDOWN_MS = 60_000;
const CALM_RESET_MS = 30_000;

/**
 * Stops sending before the server would refuse it, the way Discord does: after `limit` sends in
 * the window, nothing sends for 10 s, and every time soon after twice as long. `scope` keeps
 * separate counts where the server does (one per community room). A refusal anyway (another tab)
 * starts a cooldown too.
 */
export function useSendCooldown(limit = SEND_LIMIT, scope = "") {
  const sentAt = useRef(new Map<string, number[]>());
  // A ref as well as state, so two sends in one render both see the latest block.
  const blockedUntilRef = useRef(new Map<string, number>());
  // How many cooldowns in a row each scope has hit.
  const strikes = useRef(new Map<string, number>());
  const [blockedUntil, setBlockedUntil] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const until = blockedUntil[scope] ?? 0;
  const isCoolingDown = until > now;

  useEffect(() => {
    if (!isCoolingDown) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [isCoolingDown]);

  const block = useCallback((key: string, at: number) => {
    const next = Math.max(blockedUntilRef.current.get(key) ?? 0, at);
    blockedUntilRef.current.set(key, next);
    setBlockedUntil((current) => ({ ...current, [key]: next }));
    setNow(Date.now());
  }, []);

  /** Records a send and returns true, or returns false when it must wait. */
  const tryConsume = useCallback(() => {
    const at = Date.now();
    if (at < (blockedUntilRef.current.get(scope) ?? 0)) return false;
    const recent = (sentAt.current.get(scope) ?? []).filter((time) => at - time < SEND_WINDOW_MS);
    if (recent.length >= limit) return false;
    recent.push(at);
    sentAt.current.set(scope, recent);
    if (recent.length >= limit) {
      const lastEnded = blockedUntilRef.current.get(scope);
      const strike =
        lastEnded !== undefined && at - lastEnded < CALM_RESET_MS
          ? (strikes.current.get(scope) ?? 0) + 1
          : 0;
      strikes.current.set(scope, strike);
      const penalty = Math.min(COOLDOWN_MS * 2 ** strike, MAX_COOLDOWN_MS);
      block(scope, at + penalty);
    }
    return true;
  }, [block, limit, scope]);

  /** The server refused a send as too fast; wait as long as it said. `key` is the room it was sent to, if not this one. */
  const noteRateLimited = useCallback(
    (retryAfterSeconds?: number, key = scope) =>
      block(key, Date.now() + (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000),
    [block, scope],
  );

  return {
    isCoolingDown,
    secondsLeft: isCoolingDown ? Math.ceil((until - now) / 1000) : 0,
    tryConsume,
    noteRateLimited,
  };
}
