import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityThread } from "../hooks/community/useCommunityThread";

const mocks = vi.hoisted(() => ({
  stick: {
    onScroll: vi.fn(),
    scrollToBottom: vi.fn(),
    followIfNearBottom: vi.fn(),
    showJumpToBottom: false,
  },
}));

vi.mock("../hooks/chat/useStickToBottom", () => ({ useStickToBottom: () => mocks.stick }));
vi.mock("../hooks/useNowTick", () => ({ useNowTick: () => Date.parse("2026-10-16T12:00:00Z") }));

const message = (id, minute) => ({
  id,
  channelId: "c1",
  content: `text ${id}`,
  deleted: false,
  blocked: false,
  createdAt: new Date(Date.UTC(2026, 9, 16, 10, minute)).toISOString(),
  editedAt: null,
  author: { id: "ann", name: "Ann", image: null, badge: null },
  replyTo: null,
  media: [],
  mentions: [],
  reactions: [],
});

function makeChat(extra = {}) {
  return {
    channel: { id: "c1" },
    isLoading: false,
    messages: [message("m1", 1), message("m2", 2)],
    pending: [],
    markRead: vi.fn(),
    loadOlder: vi.fn(),
    send: vi.fn(),
    remove: { mutate: vi.fn(), reset: vi.fn() },
    ...extra,
  };
}

function setup(chat, focusMessageId) {
  return renderHook(({ chat: current, focus }) => useCommunityThread(current, focus), {
    initialProps: { chat, focus: focusMessageId },
  });
}

describe("useCommunityThread", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.stick.showJumpToBottom = false;
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("lays the messages out as rows with day dividers", () => {
    const { result } = setup(makeChat());

    expect(result.current.rows.map((row) => row.kind)).toEqual(["day", "message", "message"]);
  });

  describe("scrolling", () => {
    it("opens at the newest message once the room has loaded", () => {
      setup(makeChat());

      expect(mocks.stick.scrollToBottom).toHaveBeenCalledTimes(1);
    });

    it("does not scroll while the room is still loading", () => {
      setup(makeChat({ isLoading: true }));

      expect(mocks.stick.scrollToBottom).not.toHaveBeenCalled();
    });

    it("follows a new message only through the stick-to-bottom rule", () => {
      const chat = makeChat();
      const { rerender } = setup(chat);
      mocks.stick.followIfNearBottom.mockClear();

      rerender({ chat: { ...chat, messages: [...chat.messages, message("m3", 3)] } });

      expect(mocks.stick.followIfNearBottom).toHaveBeenCalled();
    });

    it("keeps what you were reading in place when older messages are added above", () => {
      const chat = makeChat();
      const { result, rerender } = setup(chat);
      const list = { scrollHeight: 1000, scrollTop: 40 };
      result.current.listRef(list);

      act(() => result.current.loadOlder());
      expect(chat.loadOlder).toHaveBeenCalledTimes(1);

      list.scrollHeight = 1600;
      rerender({ chat: { ...chat, messages: [message("m0", 0), ...chat.messages] } });

      expect(list.scrollTop).toBe(640);
    });

    it("leaves the scroll position alone when the oldest message did not change", () => {
      const chat = makeChat();
      const { result, rerender } = setup(chat);
      const list = { scrollHeight: 1000, scrollTop: 40 };
      result.current.listRef(list);

      list.scrollHeight = 1200;
      rerender({ chat: { ...chat, messages: [...chat.messages, message("m3", 3)] } });

      expect(list.scrollTop).toBe(40);
    });
  });

  describe("marking read", () => {
    it("marks the newest message read after it has been on screen for a moment", () => {
      const chat = makeChat();
      setup(chat);

      act(() => vi.advanceTimersByTime(799));
      expect(chat.markRead).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1));
      expect(chat.markRead).toHaveBeenCalledWith("m2");
    });

    it("waits while you are scrolled away from the newest message", () => {
      mocks.stick.showJumpToBottom = true;
      const chat = makeChat();
      setup(chat);

      act(() => vi.advanceTimersByTime(5000));

      expect(chat.markRead).not.toHaveBeenCalled();
    });

    it("does not count a hidden tab as seen", () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      const chat = makeChat();
      setup(chat);

      act(() => vi.advanceTimersByTime(5000));

      expect(chat.markRead).not.toHaveBeenCalled();
    });

    it("starts over when a newer message arrives before the moment is up", () => {
      const chat = makeChat();
      const { rerender } = setup(chat);
      act(() => vi.advanceTimersByTime(500));

      rerender({ chat: { ...chat, messages: [...chat.messages, message("m3", 3)] } });
      act(() => vi.advanceTimersByTime(500));
      expect(chat.markRead).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(300));
      expect(chat.markRead).toHaveBeenCalledTimes(1);
      expect(chat.markRead).toHaveBeenCalledWith("m3");
    });
  });

  describe("replying", () => {
    it("sends with the reply target, then clears it", () => {
      const chat = makeChat();
      const { result } = setup(chat);
      const target = message("m1", 1);

      act(() => result.current.setReplyTo(target));
      expect(result.current.replyTo).toBe(target);

      act(() => result.current.send("hi"));

      expect(chat.send).toHaveBeenCalledWith("hi", target, []);
      expect(result.current.replyTo).toBeNull();
    });

    it("hands the pictures on with the message", () => {
      const chat = makeChat();
      const { result } = setup(chat);
      const files = [new File(["x"], "a.png", { type: "image/png" })];

      act(() => result.current.send("hi", files));

      expect(chat.send).toHaveBeenCalledWith("hi", null, files);
    });

    it("sends without a reply target when none was chosen", () => {
      const chat = makeChat();
      const { result } = setup(chat);

      act(() => result.current.send("hi"));

      expect(chat.send).toHaveBeenCalledWith("hi", null, []);
    });
  });

  describe("opened from a link to one message", () => {
    const target = () => {
      const element = document.createElement("div");
      element.id = "community-message-m1";
      element.scrollIntoView = vi.fn();
      document.body.append(element);
      return element;
    };

    it("scrolls to the message when it is already loaded", () => {
      const element = target();

      setup(makeChat(), "m1");

      expect(element.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(element.classList.contains("flash")).toBe(true);
    });

    it("does nothing without a link", () => {
      const element = target();

      setup(makeChat());

      expect(element.scrollIntoView).not.toHaveBeenCalled();
    });

    it("waits for the room to load before looking", () => {
      const element = target();

      setup(makeChat({ isLoading: true }), "m1");

      expect(element.scrollIntoView).not.toHaveBeenCalled();
    });

    it("loads older messages while the message is not there yet, then scrolls once it shows up", () => {
      const chat = makeChat({ hasOlder: true, isLoadingOlder: false });
      const { rerender } = setup(chat, "m1");
      expect(chat.loadOlder).toHaveBeenCalledTimes(1);

      const element = target();
      rerender({ chat: { ...chat, messages: [message("m0", 0), ...chat.messages] }, focus: "m1" });

      expect(element.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("does not ask for another page while one is loading", () => {
      const chat = makeChat({ hasOlder: true, isLoadingOlder: true });

      setup(chat, "m1");

      expect(chat.loadOlder).not.toHaveBeenCalled();
    });

    it("gives up when the history runs out", () => {
      const chat = makeChat({ hasOlder: false });

      setup(chat, "gone");

      expect(chat.loadOlder).not.toHaveBeenCalled();
    });

    it("gives up after a few pages instead of loading the whole room", () => {
      const chat = makeChat({ hasOlder: true, isLoadingOlder: false });
      const { rerender } = setup(chat, "gone");

      for (let page = 1; page <= 10; page += 1) {
        rerender({ chat: { ...chat, messages: [...chat.messages, message(`x${page}`, 10 + page)] }, focus: "gone" });
      }

      expect(chat.loadOlder.mock.calls.length).toBeLessThanOrEqual(6);
    });
  });

  describe("jumpTo", () => {
    it("scrolls to the quoted message and flashes it briefly", () => {
      const element = document.createElement("div");
      element.id = "community-message-m1";
      element.scrollIntoView = vi.fn();
      document.body.append(element);
      const { result } = setup(makeChat());

      act(() => result.current.jumpTo("m1"));

      expect(element.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
      expect(element.classList.contains("flash")).toBe(true);
      act(() => vi.advanceTimersByTime(1600));
      expect(element.classList.contains("flash")).toBe(false);
    });

    it("does nothing when the message is not on the page", () => {
      const { result } = setup(makeChat());

      expect(() => act(() => result.current.jumpTo("gone"))).not.toThrow();
    });
  });

  describe("removing", () => {
    it("removes the chosen message, then closes the question once it worked", () => {
      const chat = makeChat();
      const { result } = setup(chat);
      act(() => result.current.setRemoveTarget({ id: "m2" }));

      act(() => result.current.confirmRemove());

      expect(chat.remove.mutate).toHaveBeenCalledWith({ messageId: "m2" }, expect.any(Object));
      expect(result.current.removeTarget).toEqual({ id: "m2" });

      act(() => chat.remove.mutate.mock.calls[0][1].onSuccess());
      expect(result.current.removeTarget).toBeNull();
    });

    it("clears the error and the choice when the question is dismissed", () => {
      const chat = makeChat();
      const { result } = setup(chat);
      act(() => result.current.setRemoveTarget({ id: "m2" }));

      act(() => result.current.closeRemove());

      expect(chat.remove.reset).toHaveBeenCalled();
      expect(result.current.removeTarget).toBeNull();
    });
  });
});
