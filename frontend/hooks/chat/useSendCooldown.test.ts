// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEND_LIMIT, SEND_WINDOW_MS } from "../../lib/chat/messageLimits";
import { useSendCooldown } from "./useSendCooldown";

describe("useSendCooldown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lets the server's limit through, then blocks a burst for 10 seconds", () => {
    const { result } = renderHook(() => useSendCooldown());

    const sent: boolean[] = [];
    act(() => {
      for (let i = 0; i < SEND_LIMIT + 3; i += 1) sent.push(result.current.tryConsume());
    });

    expect(sent.filter(Boolean)).toHaveLength(SEND_LIMIT);
    expect(result.current.isCoolingDown).toBe(true);
    expect(result.current.secondsLeft).toBe(10);

    act(() => vi.advanceTimersByTime(9_000));
    expect(result.current.isCoolingDown).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));

    expect(result.current.isCoolingDown).toBe(false);
    let again = false;
    act(() => {
      again = result.current.tryConsume();
    });
    expect(again).toBe(true);
  });

  it("does not block sends slower than the limit", () => {
    const { result } = renderHook(() => useSendCooldown());

    for (let i = 0; i < SEND_LIMIT * 2; i += 1) {
      let sent = false;
      act(() => {
        sent = result.current.tryConsume();
      });
      expect(sent).toBe(true);
      act(() => vi.advanceTimersByTime(SEND_WINDOW_MS / (SEND_LIMIT - 1) + 100));
    }
  });

  it("doubles the cooldown each time the limit is hit again soon after, and starts over after a calm spell", () => {
    const { result } = renderHook(() => useSendCooldown(2));
    const spamUntilBlocked = () => {
      act(() => {
        while (result.current.tryConsume()) {
          // keep sending until refused
        }
      });
      return result.current.secondsLeft;
    };
    const waitOut = () => act(() => vi.advanceTimersByTime(result.current.secondsLeft * 1000));

    expect(spamUntilBlocked()).toBe(10);
    waitOut();
    expect(spamUntilBlocked()).toBe(20);
    waitOut();
    expect(spamUntilBlocked()).toBe(40);
    waitOut();
    expect(spamUntilBlocked()).toBe(60);
    waitOut();

    act(() => vi.advanceTimersByTime(30_000));
    expect(spamUntilBlocked()).toBe(10);
  });

  it("counts each room on its own, as the server does", () => {
    const { result, rerender } = renderHook(({ scope }) => useSendCooldown(2, scope), {
      initialProps: { scope: "room-a" },
    });

    act(() => {
      result.current.tryConsume();
      result.current.tryConsume();
    });
    expect(result.current.isCoolingDown).toBe(true);

    rerender({ scope: "room-b" });
    expect(result.current.isCoolingDown).toBe(false);
    let sent = false;
    act(() => {
      sent = result.current.tryConsume();
    });
    expect(sent).toBe(true);

    rerender({ scope: "room-a" });
    expect(result.current.isCoolingDown).toBe(true);
  });

  it("waits as long as the server said when it refuses a send anyway", () => {
    const { result } = renderHook(() => useSendCooldown());

    act(() => result.current.noteRateLimited(3));

    expect(result.current.secondsLeft).toBe(3);
    let sent = true;
    act(() => {
      sent = result.current.tryConsume();
    });
    expect(sent).toBe(false);

    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.isCoolingDown).toBe(false);
  });
});
