import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relativeTime } from "./chatDisplay";

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads 'Just now' for anything under a minute old", () => {
    expect(relativeTime(new Date("2026-01-01T11:59:59.000Z"))).toBe("Just now");
  });

  it("reads in minutes for anything under an hour old - it used to always jump straight to '1h ago'", () => {
    expect(relativeTime(new Date("2026-01-01T11:58:00.000Z"))).toBe("2m ago");
    expect(relativeTime(new Date("2026-01-01T11:01:00.000Z"))).toBe("59m ago");
  });

  it("reads in hours once at least an hour old", () => {
    expect(relativeTime(new Date("2026-01-01T11:00:00.000Z"))).toBe("1h ago");
    expect(relativeTime(new Date("2026-01-01T09:00:00.000Z"))).toBe("3h ago");
  });

  it("reads in days once at least a day old", () => {
    expect(relativeTime(new Date("2025-12-30T12:00:00.000Z"))).toBe("2d ago");
  });

  it("falls back to 'Recently' for a missing or invalid value", () => {
    expect(relativeTime(null)).toBe("Recently");
    expect(relativeTime("not a date")).toBe("Recently");
  });
});
