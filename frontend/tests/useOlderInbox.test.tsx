import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cursorAfter, useOlderInbox } from "../hooks/chat/useOlderInbox";
import { INBOX_PAGE_SIZE } from "../lib/queries";

const mocks = vi.hoisted(() => ({ getChatConversations: vi.fn() }));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { ...actual.api, getChatConversations: mocks.getChatConversations } };
});

// Newest first, one minute apart.
const chat = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `c${n}`,
  updatedAt: new Date(Date.UTC(2026, 9, 22, 12, 0) - n * 60_000).toISOString(),
  pinnedAt: null,
  ...extra,
});
const chats = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => chat(from + i));

function setup(firstPage: ReturnType<typeof chat>[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useOlderInbox(firstPage, true), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe("cursorAfter", () => {
  it("starts after the last unpinned chat of a full page, whatever is pinned", () => {
    const page = [chat(0, { pinnedAt: "2026-10-01T00:00:00.000Z" }), ...chats(1, INBOX_PAGE_SIZE)];

    expect(cursorAfter(page)).toEqual({
      id: `c${INBOX_PAGE_SIZE}`,
      updatedAt: chat(INBOX_PAGE_SIZE).updatedAt,
    });
  });

  it("has nothing after a page that was not full", () => {
    expect(cursorAfter(chats(1, INBOX_PAGE_SIZE - 1))).toBeNull();
  });
});

describe("useOlderInbox", () => {
  beforeEach(() => mocks.getChatConversations.mockReset());

  it("loads nothing until asked, then the page after the first", async () => {
    mocks.getChatConversations.mockResolvedValue(chats(51, 10));
    const { result } = setup(chats(1, INBOX_PAGE_SIZE));

    expect(result.current.hasMore).toBe(true);
    expect(mocks.getChatConversations).not.toHaveBeenCalled();

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.conversations).toHaveLength(10));
    expect(mocks.getChatConversations).toHaveBeenCalledWith({
      limit: INBOX_PAGE_SIZE,
      beforeUpdatedAt: chat(INBOX_PAGE_SIZE).updatedAt,
      beforeId: `c${INBOX_PAGE_SIZE}`,
    });
    expect(result.current.hasMore).toBe(false);
  });

  it("never offers more when the first page was not full", () => {
    const { result } = setup(chats(1, 3));

    expect(result.current.hasMore).toBe(false);
  });

  it("shows a chat that moved up into the first page only once", async () => {
    const firstPage = chats(1, INBOX_PAGE_SIZE);
    mocks.getChatConversations.mockResolvedValue([chat(3), chat(60)]);
    const { result } = setup(firstPage);

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.conversations.map((c) => c.id)).toEqual(["c60"]));
  });
});
