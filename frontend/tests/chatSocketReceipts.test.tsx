import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSocket } from "../hooks/chat/useChatSocket";
import { queryKeys } from "../lib/queries";
import { messageDeletedSignal } from "../lib/chat/messageDeletedSignal";

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, (payload: any) => void>,
  markChatDelivered: vi.fn(),
}));

vi.mock("../lib/socket/sharedSocket", () => ({
  useSharedSocket: () => ({
    on: (event: string, handler: (payload: any) => void) => {
      mocks.handlers[event] = handler;
    },
    off: (event: string) => {
      delete mocks.handlers[event];
    },
    emit: () => {},
  }),
}));
vi.mock("../lib/api", () => ({
  API_BASE_URL: "http://localhost:3000",
  api: { markChatDelivered: mocks.markChatDelivered },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const AT = "2026-10-06T10:05:00.000Z";
const KEY = queryKeys.chatMessages("c1");
const created = (messageId: string) => ({
  conversationId: "c1",
  messageId,
  senderId: "bob",
  ciphertext: "x",
  createdAt: AT,
});

function setup(seed?: { items: any[]; meta?: unknown }) {
  const client = new QueryClient();
  if (seed) client.setQueryData(KEY, seed);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = renderHook(() => useChatSocket(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { client, invalidate, view };
}

describe("useChatSocket delivery acknowledgements", () => {
  beforeEach(() => {
    mocks.handlers = {};
    mocks.markChatDelivered.mockReset().mockResolvedValue({});
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("tells the server a message arrived, shortly after it did", () => {
    setup();

    mocks.handlers["message:created"]!(created("m1"));
    expect(mocks.markChatDelivered).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);

    expect(mocks.markChatDelivered).toHaveBeenCalledTimes(1);
    expect(mocks.markChatDelivered).toHaveBeenCalledWith(["m1"]);
  });

  it("sends a burst of messages as one request", () => {
    setup();

    mocks.handlers["message:created"]!(created("m1"));
    vi.advanceTimersByTime(100);
    mocks.handlers["message:created"]!(created("m2"));
    vi.advanceTimersByTime(100);
    mocks.handlers["message:created"]!(created("m3"));
    vi.advanceTimersByTime(300);

    expect(mocks.markChatDelivered).toHaveBeenCalledTimes(1);
    expect(mocks.markChatDelivered).toHaveBeenCalledWith(["m1", "m2", "m3"]);
  });

  it("starts a fresh batch after one was sent", () => {
    setup();
    mocks.handlers["message:created"]!(created("m1"));
    vi.advanceTimersByTime(300);

    mocks.handlers["message:created"]!(created("m2"));
    vi.advanceTimersByTime(300);

    expect(mocks.markChatDelivered.mock.calls).toEqual([[["m1"]], [["m2"]]]);
  });

  it("does not send anything once the page has gone away", () => {
    const { view } = setup();
    mocks.handlers["message:created"]!(created("m1"));

    view.unmount();
    vi.advanceTimersByTime(1000);

    expect(mocks.markChatDelivered).not.toHaveBeenCalled();
  });

  it("carries on when the acknowledgement fails, delivery gets marked again when the chat opens", () => {
    mocks.markChatDelivered.mockRejectedValue(new Error("offline"));
    setup();

    mocks.handlers["message:created"]!(created("m1"));

    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
  });
});

describe("useChatSocket receipts events", () => {
  beforeEach(() => {
    mocks.handlers = {};
    mocks.markChatDelivered.mockReset().mockResolvedValue({});
  });

  const thread = () => ({
    items: [
      { id: "m1", senderId: "me", createdAt: AT, receipts: [] },
      { id: "m2", senderId: "me", createdAt: AT, receipts: [] },
    ],
    meta: { nextBeforeMessageId: null },
  });

  it("marks messages delivered when someone's device reports them", () => {
    const { client } = setup(thread());

    mocks.handlers["receipts:updated"]!({
      kind: "delivered",
      conversationId: "c1",
      userId: "bob",
      messageIds: ["m2"],
    });

    const items = client.getQueryData<{ items: any[]; meta?: unknown }>(KEY)!.items;
    expect(items[0].receipts).toEqual([]);
    expect(items[1].receipts).toEqual([{ userId: "bob", delivered: true, readAt: null }]);
  });

  it("marks everything up to a message read when someone reads", () => {
    const { client } = setup(thread());

    mocks.handlers["receipts:updated"]!({
      kind: "read",
      conversationId: "c1",
      userId: "bob",
      upToMessageId: "m2",
      at: AT,
    });

    const items = client.getQueryData<{ items: any[]; meta?: unknown }>(KEY)!.items;
    expect(items.map((item) => item.receipts)).toEqual([
      [{ userId: "bob", delivered: true, readAt: AT }],
      [{ userId: "bob", delivered: true, readAt: AT }],
    ]);
  });

  it("keeps the rest of the cached page as it was", () => {
    const { client } = setup(thread());

    mocks.handlers["receipts:updated"]!({
      kind: "delivered",
      conversationId: "c1",
      userId: "bob",
      messageIds: ["m1"],
    });

    expect(client.getQueryData<{ items: any[]; meta?: unknown }>(KEY)!.meta).toEqual({
      nextBeforeMessageId: null,
    });
  });

  it("fetches the thread fresh when a read points at a message it does not have", () => {
    const { client, invalidate } = setup(thread());

    mocks.handlers["receipts:updated"]!({
      kind: "read",
      conversationId: "c1",
      userId: "bob",
      upToMessageId: "unknown",
      at: AT,
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
    expect(client.getQueryData<{ items: any[]; meta?: unknown }>(KEY)!.items[0].receipts).toEqual(
      [],
    );
  });

  it("ignores a thread that is not loaded, there is nothing to patch", () => {
    const { client, invalidate } = setup();

    mocks.handlers["receipts:updated"]!({
      kind: "delivered",
      conversationId: "c1",
      userId: "bob",
      messageIds: ["m1"],
    });

    expect(client.getQueryData<{ items: any[]; meta?: unknown }>(KEY)!).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

// #102: the cached copy must say deleted before the refetch, or one pushed out of the window moves to older history as it was.
describe("useChatSocket message deletes", () => {
  beforeEach(() => {
    mocks.handlers = {};
  });

  it("marks the message deleted in the cached thread at once, then fetches the thread fresh", () => {
    const { client, invalidate } = setup({
      items: [
        { id: "m1", senderId: "bob", createdAt: AT, status: "SENT" },
        { id: "m2", senderId: "bob", createdAt: AT, status: "SENT" },
      ],
    });

    mocks.handlers["message:deleted"]!({ conversationId: "c1", messageId: "m1" });

    const items = client.getQueryData<{ items: any[] }>(KEY)!.items;
    expect(items.map((item) => item.status)).toEqual(["DELETED", "SENT"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
  });

  it("tells older history outside the cache about the delete", () => {
    const heard: string[][] = [];
    const stop = messageDeletedSignal.subscribe((conversationId, messageId) =>
      heard.push([conversationId, messageId]),
    );
    setup();

    mocks.handlers["message:deleted"]!({ conversationId: "c1", messageId: "m1" });

    expect(heard).toEqual([["c1", "m1"]]);
    stop();
  });
});
