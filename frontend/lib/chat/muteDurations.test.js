import { describe, expect, it } from "vitest";
import { MUTE_OPTIONS, UNMUTE, describeMutedUntil, muteChange } from "./muteDurations";

const option = (id) => MUTE_OPTIONS.find((item) => item.id === id);
const now = new Date("2026-10-05T12:00:00.000Z").getTime();

describe("MUTE_OPTIONS", () => {
  it("offers the five agreed durations, ending with open-ended", () => {
    expect(MUTE_OPTIONS.map((item) => item.label)).toEqual([
      "15 minutes",
      "1 hour",
      "8 hours",
      "24 hours",
      "Until I turn it back on",
    ]);
  });
});

describe("muteChange", () => {
  it("mutes until the chosen time", () => {
    expect(muteChange(option("1h"), now)).toEqual({
      notificationLevel: "NOTHING",
      mutedUntil: "2026-10-05T13:00:00.000Z",
    });
    expect(muteChange(option("15m"), now).mutedUntil).toBe("2026-10-05T12:15:00.000Z");
    expect(muteChange(option("24h"), now).mutedUntil).toBe("2026-10-06T12:00:00.000Z");
  });

  it("sends no end time for an open-ended mute", () => {
    expect(muteChange(option("forever"), now)).toEqual({
      notificationLevel: "NOTHING",
      mutedUntil: undefined,
    });
  });

  it("unmute is level ALL", () => {
    expect(UNMUTE).toEqual({ notificationLevel: "ALL" });
  });
});

describe("describeMutedUntil", () => {
  it("shows just the time when it ends today", () => {
    const today = new Date(2026, 9, 5, 15, 40);

    expect(describeMutedUntil(today.toISOString(), new Date(2026, 9, 5, 9, 0))).toMatch(/^Muted until .*3:40/);
    expect(describeMutedUntil(today.toISOString(), new Date(2026, 9, 5, 9, 0))).not.toMatch(/Oct/);
  });

  it("adds the date when it ends another day", () => {
    const tomorrow = new Date(2026, 9, 6, 15, 40);

    expect(describeMutedUntil(tomorrow.toISOString(), new Date(2026, 9, 5, 9, 0))).toMatch(/Oct 6, .*3:40/);
  });

  it("says until you turn it back on when there is no end time", () => {
    expect(describeMutedUntil(null)).toBe("Muted until you turn it back on");
  });
});
