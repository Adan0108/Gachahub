import { describe, expect, it } from "vitest";
import { countWaitingChats } from "./waitingChats";

const chat = (unreadCount: number, isMuted = false) => ({
  unreadCount,
  participants: [{ userId: "me", isMuted }],
});

describe("countWaitingChats", () => {
  it("counts chats with unread messages, not the messages", () => {
    expect(countWaitingChats([chat(5), chat(1), chat(0)], [], "me")).toBe(2);
  });

  it("leaves muted chats out", () => {
    expect(countWaitingChats([chat(2, true), chat(2)], [], "me")).toBe(1);
  });

  it("adds every pending request", () => {
    expect(countWaitingChats([chat(1)], [{}, {}], "me")).toBe(3);
  });

  it("is zero before anything has loaded, and once everything is read", () => {
    expect(countWaitingChats(undefined, undefined, "me")).toBe(0);
    expect(countWaitingChats([chat(0)], [], "me")).toBe(0);
  });
});
