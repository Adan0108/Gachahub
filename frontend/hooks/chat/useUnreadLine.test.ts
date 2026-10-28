// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnreadLine } from "./useUnreadLine";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 26, 9, minute)).toISOString();
const message = (id: string, minute: number, senderId = "bob", readAt: string | null = null) => ({
  id,
  senderId,
  createdAt: at(minute),
  receipts: [{ userId: "me", readAt }],
});
const read = (id: string, minute: number) => message(id, minute, "bob", at(minute));

type Props = Parameters<typeof useUnreadLine>[0];

function setup(overrides: Partial<Props> = {}) {
  const markRead = vi.fn();
  const base: Props = {
    conversationId: "c1",
    messages: [read("m1", 0), message("m2", 1), message("m3", 2)],
    newestPageItems: [read("m1", 0), message("m2", 1), message("m3", 2)],
    unreadCount: 2,
    userId: "me",
    atBottom: true,
    markRead,
    sentCount: 0,
    ...overrides,
  };
  const hook = renderHook((props: Props) => useUnreadLine(props), { initialProps: base });
  return { ...hook, base, markRead };
}

describe("useUnreadLine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("puts the line above the first message you had not read when the chat opened", () => {
    const { result } = setup();
    expect(result.current.line?.id).toBe("m2");
  });

  it("shows no line when the server says nothing is unread, whatever the cached page says", () => {
    const { result } = setup({ unreadCount: 0 });
    expect(result.current.line).toBeNull();
  });

  it("keeps the line while you read, then takes it away once all is read and you stay at the bottom", () => {
    const { result, rerender, base } = setup();
    rerender({ ...base, unreadCount: 0 });
    expect(result.current.line?.id).toBe("m2");

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.line).toBeNull();
  });

  it("puts the line above a message that arrives while you are scrolled up", () => {
    const { result, rerender, base } = setup({ messages: [read("m1", 0)], unreadCount: 0 });
    rerender({ ...base, messages: [read("m1", 0), message("m4", 5)], unreadCount: 1, atBottom: false });
    expect(result.current.line?.id).toBe("m4");
  });

  it("adds no line for a message that arrives while you watch the bottom, even with another window focused", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result, rerender, base } = setup({ messages: [read("m1", 0)], unreadCount: 0 });
    rerender({ ...base, messages: [read("m1", 0), message("m4", 5)], unreadCount: 1 });
    expect(result.current.line).toBeNull();
  });

  it("does not count older history loading in as new", () => {
    const { result, rerender, base } = setup({ messages: [read("m1", 10)], unreadCount: 0, atBottom: false });
    rerender({ ...base, messages: [message("old", 1), read("m1", 10)], unreadCount: 0, atBottom: false });
    expect(result.current.line).toBeNull();
  });

  it("marking everything read takes the line away and marks up to the newest message from others", () => {
    const { result, markRead } = setup();
    act(() => result.current.markAllRead());
    expect(markRead).toHaveBeenCalledWith("m3");
    expect(result.current.line).toBeNull();
    expect(result.current.bar).toBeNull();
  });

  it("marks up to a message that still exists when the newest one was unsent", () => {
    const { result, markRead } = setup({
      newestPageItems: [read("m1", 0), message("m2", 1), { ...message("m3", 2), status: "DELETED" }],
    });
    act(() => result.current.markAllRead());
    expect(markRead).toHaveBeenCalledWith("m2");
  });

  it("shows the bar with the server's count while there is a line and something unread", () => {
    const { result, rerender, base } = setup();
    expect(result.current.bar).toEqual({ count: 2, since: Date.parse(at(1)) });
    rerender({ ...base, unreadCount: 0 });
    expect(result.current.bar).toBeNull();
  });

  it("places the line afresh when you leave the chat and come back", () => {
    const { result, rerender, base } = setup();
    rerender({ ...base, conversationId: "" });
    rerender({ ...base, messages: [read("m1", 0), read("m2", 1), message("m3", 2)], unreadCount: 1 });
    expect(result.current.line?.id).toBe("m3");
  });

  it("sending a message takes the line away", () => {
    const { result, rerender, base } = setup();
    rerender({ ...base, sentCount: 1 });
    expect(result.current.line).toBeNull();
  });
});
