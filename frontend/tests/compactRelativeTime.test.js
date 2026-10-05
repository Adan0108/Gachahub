import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compactRelativeTime } from "../lib/time";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const ago = (ms) => new Date(NOW.valueOf() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("compactRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("says Just now under a minute", () => {
    expect(compactRelativeTime(ago(30_000))).toBe("Just now");
  });

  it("counts minutes, hours, days, and weeks", () => {
    expect(compactRelativeTime(ago(MIN))).toBe("1m");
    expect(compactRelativeTime(ago(5 * MIN))).toBe("5m");
    expect(compactRelativeTime(ago(59 * MIN))).toBe("59m");
    expect(compactRelativeTime(ago(HOUR))).toBe("1h");
    expect(compactRelativeTime(ago(3 * HOUR))).toBe("3h");
    expect(compactRelativeTime(ago(2 * DAY))).toBe("2d");
    expect(compactRelativeTime(ago(8 * DAY))).toBe("1w");
  });

  it("treats a time slightly in the future (clock drift) as Just now", () => {
    expect(compactRelativeTime(new Date(NOW.valueOf() + 5_000).toISOString())).toBe("Just now");
  });

  it("returns nothing for a missing or invalid time", () => {
    expect(compactRelativeTime(null)).toBe("");
    expect(compactRelativeTime("nope")).toBe("");
  });
});
