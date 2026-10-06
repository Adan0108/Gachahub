import { describe, expect, it } from "vitest";
import { applyMute } from "./applyMute";

const list = [
  {
    id: "c1",
    participants: [
      { userId: "me", notificationLevel: "ALL", mutedUntil: null, isMuted: false },
      { userId: "peer", notificationLevel: null, mutedUntil: null, isMuted: null },
    ],
  },
  { id: "c2", participants: [{ userId: "me", notificationLevel: "ALL", mutedUntil: null, isMuted: false }] },
];
const mine = (conversations, id) =>
  conversations.find((c) => c.id === id).participants.find((p) => p.userId === "me");

describe("applyMute", () => {
  it("mutes only your row in the one conversation", () => {
    const next = applyMute(list, "c1", "me", { notificationLevel: "NOTHING", mutedUntil: "2026-10-05T15:40:00.000Z" });

    expect(mine(next, "c1")).toEqual({
      userId: "me",
      notificationLevel: "NOTHING",
      mutedUntil: "2026-10-05T15:40:00.000Z",
      isMuted: true,
    });
    expect(next[0].participants[1]).toBe(list[0].participants[1]);
    expect(next[1]).toBe(list[1]);
  });

  it("mutes with no end time when none is given", () => {
    const next = applyMute(list, "c1", "me", { notificationLevel: "NOTHING" });

    expect(mine(next, "c1")).toMatchObject({ isMuted: true, mutedUntil: null });
  });

  it("unmutes and clears the end time", () => {
    const muted = applyMute(list, "c1", "me", { notificationLevel: "NOTHING", mutedUntil: "2026-10-05T15:40:00.000Z" });
    const next = applyMute(muted, "c1", "me", { notificationLevel: "ALL" });

    expect(mine(next, "c1")).toMatchObject({ notificationLevel: "ALL", isMuted: false, mutedUntil: null });
  });

  it("does not change the original list", () => {
    applyMute(list, "c1", "me", { notificationLevel: "NOTHING" });

    expect(mine(list, "c1").isMuted).toBe(false);
  });

  it("passes an unloaded list through", () => {
    expect(applyMute(undefined, "c1", "me", { notificationLevel: "NOTHING" })).toBeUndefined();
  });
});
