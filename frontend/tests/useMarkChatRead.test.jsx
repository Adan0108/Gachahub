import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMarkChatRead } from "../hooks/chat/useMarkChatRead";
import { queryKeys } from "../lib/queries";

const mocks = vi.hoisted(() => ({ markChatRead: vi.fn() }));

vi.mock("../lib/api", () => ({
  api: { markChatRead: mocks.markChatRead },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.chatConversations, [
    { id: "c1", unreadCount: 3 },
    { id: "c2", unreadCount: 5 },
  ]);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useMarkChatRead(), { wrapper });
  const unread = (id) => client.getQueryData(queryKeys.chatConversations).find((c) => c.id === id).unreadCount;
  return { markRead: result, invalidate, unread };
}

describe("useMarkChatRead", () => {
  beforeEach(() => {
    mocks.markChatRead.mockReset();
  });

  it("clears the unread count straight away when the newest message was read", () => {
    mocks.markChatRead.mockReturnValue(new Promise(() => {}));
    const { markRead, unread } = setup();

    act(() => {
      markRead.current("c1", "m3", { isNewest: true });
    });

    expect(mocks.markChatRead).toHaveBeenCalledWith("c1", "m3");
    expect(unread("c1")).toBe(0);
    expect(unread("c2")).toBe(5);
  });

  it("leaves the count to the server when only an older message was read", async () => {
    mocks.markChatRead.mockReturnValue(new Promise(() => {}));
    const { markRead, unread } = setup();

    act(() => {
      markRead.current("c1", "m1", { isNewest: false });
    });

    expect(unread("c1")).toBe(3);
  });

  it("refreshes the chat list and the notifications once the server answers", async () => {
    mocks.markChatRead.mockResolvedValue({ readCount: 1 });
    const { markRead, invalidate } = setup();

    await act(() => markRead.current("c1", "m3", { isNewest: true }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chatConversations });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.notifications });
  });

  it("still refreshes the list when the server refuses, so the true count comes back", async () => {
    mocks.markChatRead.mockRejectedValue(new Error("nope"));
    const { markRead, invalidate } = setup();

    await act(() => markRead.current("c1", "m3", { isNewest: true }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chatConversations });
  });
});
