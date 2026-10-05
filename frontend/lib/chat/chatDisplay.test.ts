import { describe, expect, it } from "vitest";
import { conversationImage, conversationMute } from "./chatDisplay";

const direct = {
  type: "DIRECT",
  participants: [
    { userId: "me", user: { id: "me", image: "https://cdn/me.png" } },
    { userId: "peer", user: { id: "peer", image: "https://cdn/peer.png" } },
  ],
};

describe("conversationImage", () => {
  it("is the other participant's picture in a direct chat", () => {
    expect(conversationImage(direct, "me")).toBe("https://cdn/peer.png");
  });

  it("is null when the peer has no picture", () => {
    const noPicture = {
      ...direct,
      participants: [direct.participants[0], { userId: "peer", user: { id: "peer", image: null } }],
    };

    expect(conversationImage(noPicture, "me")).toBeNull();
  });

  it("is null for a group, even though members have pictures", () => {
    expect(conversationImage({ ...direct, type: "GROUP" }, "me")).toBeNull();
  });

  it("is null for a missing conversation", () => {
    expect(conversationImage(undefined, "me")).toBeNull();
  });
});

describe("conversationMute", () => {
  const withMine = (mine: object) => ({
    ...direct,
    participants: [{ ...direct.participants[0], ...mine }, direct.participants[1]],
  });

  it("is not muted by default", () => {
    expect(conversationMute(direct, "me")).toEqual({ isMuted: false, mutedUntil: null });
  });

  it("reads your own muted flag and end time", () => {
    const until = "2026-10-05T15:40:00.000Z";

    expect(conversationMute(withMine({ isMuted: true, mutedUntil: until }), "me")).toEqual({
      isMuted: true,
      mutedUntil: until,
    });
  });

  it("is muted with no end time for an open-ended mute", () => {
    expect(conversationMute(withMine({ isMuted: true, mutedUntil: null }), "me")).toEqual({
      isMuted: true,
      mutedUntil: null,
    });
  });

  it("never reads someone else's mute", () => {
    const theirs = { ...direct, participants: [direct.participants[0], { ...direct.participants[1], isMuted: true }] };

    expect(conversationMute(theirs, "me").isMuted).toBe(false);
  });

  it("is not muted for a missing conversation", () => {
    expect(conversationMute(undefined, "me")).toEqual({ isMuted: false, mutedUntil: null });
  });
});
