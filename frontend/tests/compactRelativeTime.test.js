import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compactRelativeTime, messageDateLabel } from "../lib/time";

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

describe("messageDateLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("counts how long ago for the past week", () => {
    expect(messageDateLabel(ago(5 * MIN))).toBe("5m");
    expect(messageDateLabel(ago(6 * DAY))).toBe("6d");
  });

  it("switches to the date after a week", () => {
    expect(messageDateLabel(ago(10 * DAY))).toBe("Sep 25");
  });

  it("adds the year for another year", () => {
    expect(messageDateLabel("2025-03-04T12:00:00.000Z")).toBe("Mar 4, 2025");
  });

  it("returns nothing for a missing or invalid time", () => {
    expect(messageDateLabel(null)).toBe("");
    expect(messageDateLabel("nope")).toBe("");
  });
});
