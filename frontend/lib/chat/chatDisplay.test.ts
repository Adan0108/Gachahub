import { describe, expect, it } from "vitest";
import { conversationImage } from "./chatDisplay";

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
