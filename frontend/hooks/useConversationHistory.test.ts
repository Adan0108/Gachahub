// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationHistory, type ConversationHistory } from "./useConversationHistory";

const { getChatMessages } = vi.hoisted(() => ({ getChatMessages: vi.fn() }));
vi.mock("../lib/api", () => ({ api: { getChatMessages } }));

interface Message {
  id: string;
  createdAt: string;
}
type Page = { items: Message[]; meta: { nextBeforeMessageId: string | null } };

const message = (n: number): Message => ({
  id: `m${n}`,
  createdAt: `2026-09-01T00:00:${String(n).padStart(2, "0")}.000Z`,
});
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => message(from + i));
const page = (items: Message[], next: string | null = null): Page => ({
  items,
  meta: { nextBeforeMessageId: next },
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

function renderHistory() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let latest = {} as ConversationHistory<Message>;

  function Harness(props: { conversationId: string; page: Page | undefined }) {
    latest = useConversationHistory(props.conversationId, props.page);
    return null;
  }

  return {
    get value() {
      return latest;
    },
    render: async (props: { conversationId: string; page: Page | undefined }) => {
      await act(async () => {
        root.render(createElement(Harness, props));
      });
      await flush();
    },
    scrollToTop: async () => {
      await act(async () => {
        latest.handleScroll({ currentTarget: { scrollTop: 0 } } as never);
      });
      await flush();
    },
    unmount: () => act(() => root.unmount()),
  };
}

const ids = (messages: Message[]) => messages.map((m) => m.id);

describe("useConversationHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders before the first page has loaded without looping", async () => {
    const hook = renderHistory();

    await hook.render({ conversationId: "c1", page: undefined });

    expect(hook.value.displayMessages).toEqual([]);
    await hook.unmount();
  });

  it("loads an older batch on scrolling to the top and puts it before the newest window", async () => {
    getChatMessages.mockResolvedValue(page(range(1, 2), null));
    const hook = renderHistory();
    await hook.render({ conversationId: "c1", page: page(range(3, 5), "m3") });

    await hook.scrollToTop();

    expect(getChatMessages).toHaveBeenCalledWith("c1", { beforeMessageId: "m3", limit: 50 });
    expect(ids(hook.value.displayMessages)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    await hook.unmount();
  });

  it("stops asking once there is no older history", async () => {
    const hook = renderHistory();
    await hook.render({ conversationId: "c1", page: page(range(1, 3), null) });

    await hook.scrollToTop();

    expect(getChatMessages).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it("folds messages that scroll off the end of the window into older history", async () => {
    const hook = renderHistory();
    await hook.render({ conversationId: "c1", page: page(range(1, 30), "m1") });

    await hook.render({ conversationId: "c1", page: page(range(3, 32), "m3") });

    expect(ids(hook.value.displayMessages)).toEqual(ids(range(1, 32)));
    await hook.unmount();
  });

  it("does not bring a deleted message back", async () => {
    const hook = renderHistory();
    await hook.render({ conversationId: "c1", page: page(range(1, 10), null) });

    await hook.render({ conversationId: "c1", page: page(range(2, 10), null) });

    expect(ids(hook.value.displayMessages)).toEqual(ids(range(2, 10)));
    await hook.unmount();
  });

  it("starts over when the conversation changes", async () => {
    getChatMessages.mockResolvedValue(page(range(1, 2), null));
    const hook = renderHistory();
    await hook.render({ conversationId: "c1", page: page(range(3, 5), "m3") });
    await hook.scrollToTop();

    await hook.render({ conversationId: "c2", page: page([message(9)], null) });

    expect(ids(hook.value.displayMessages)).toEqual(["m9"]);
    await hook.unmount();
  });

  it("pauses on a 429, counts down, and resumes on its own while still at the top", async () => {
    vi.useFakeTimers();
    getChatMessages
      .mockRejectedValueOnce(
        Object.assign(new Error("slow down"), { status: 429, retryAfterSeconds: 4 }),
      )
      .mockResolvedValueOnce(page(range(1, 2), null));
    const hook = renderHistory();
    await hook.render({ conversationId: "c1", page: page(range(3, 5), "m3") });

    await hook.scrollToTop();

    expect(hook.value.isWaitingOnRateLimit).toBe(true);
    expect(hook.value.rateLimitSecondsLeft).toBe(4);
    expect(getChatMessages).toHaveBeenCalledTimes(1);

    // scrollTop is undefined in jsdom without a container, so simulate "still at the top".
    await act(async () => {
      hook.value.containerRef.current = { scrollTop: 0, scrollHeight: 0 } as HTMLDivElement;
      await vi.advanceTimersByTimeAsync(4000);
    });
    await flush();

    expect(hook.value.isWaitingOnRateLimit).toBe(false);
    expect(getChatMessages).toHaveBeenCalledTimes(2);
    expect(ids(hook.value.displayMessages)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    await hook.unmount();
  });
});
