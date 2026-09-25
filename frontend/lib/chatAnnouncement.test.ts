import { describe, expect, it } from "vitest";
import { nextAnnouncement, type AnnouncementState } from "./chatAnnouncement";

const start: AnnouncementState = { conversationId: "c1", lastId: undefined, text: "", seq: 0 };
const input = (
  last: { id: string; senderId: string; contentType?: string } | null | undefined,
) => ({
  conversationId: "c1",
  last,
  ownUserId: "me",
  senderName: "Ana",
});

describe("nextAnnouncement", () => {
  it("stays silent for the first load", () => {
    const state = nextAnnouncement(start, input({ id: "m1", senderId: "ana" }));
    expect(state.text).toBe("");
    expect(state.lastId).toBe("m1");
  });

  it("announces a new message from someone else", () => {
    const loaded = nextAnnouncement(start, input({ id: "m1", senderId: "ana" }));
    const next = nextAnnouncement(loaded, input({ id: "m2", senderId: "ana" }));
    expect(next.text).toBe("New message from Ana");
    expect(next.seq).toBe(1);
  });

  it("announces the first message of an empty conversation", () => {
    const loaded = nextAnnouncement(start, input(null));
    expect(nextAnnouncement(loaded, input({ id: "m1", senderId: "ana" })).text).toBe(
      "New message from Ana",
    );
  });

  it("ignores my own and system messages", () => {
    const loaded = nextAnnouncement(start, input({ id: "m1", senderId: "ana" }));
    expect(nextAnnouncement(loaded, input({ id: "m2", senderId: "me" })).seq).toBe(0);
    expect(
      nextAnnouncement(loaded, input({ id: "m3", senderId: "ana", contentType: "SYSTEM" })).seq,
    ).toBe(0);
  });

  it("resets silently when the conversation changes", () => {
    const loaded = nextAnnouncement(start, input({ id: "m1", senderId: "ana" }));
    const switched = nextAnnouncement(loaded, {
      ...input({ id: "x9", senderId: "ana" }),
      conversationId: "c2",
    });
    expect(switched.text).toBe("");
    expect(switched.lastId).toBe("x9");
  });
});
