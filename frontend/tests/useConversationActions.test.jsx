import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationActions } from "../hooks/chat/useConversationActions";

const mocks = vi.hoisted(() => ({ block: vi.fn(), archive: vi.fn(), unarchive: vi.fn(), remove: vi.fn() }));

vi.mock("../lib/api", () => ({
  api: {
    blockChatConversation: mocks.block,
    archiveChatConversation: mocks.archive,
    unarchiveChatConversation: mocks.unarchive,
    deleteChatConversation: mocks.remove,
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

function setup(options) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useConversationActions(options), { wrapper });
  return { actions: result, invalidate };
}

describe("useConversationActions", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue({}));
  });

  it.each([
    ["block", "block"],
    ["archive", "archive"],
    ["unarchive", "unarchive"],
    ["remove", "remove"],
  ])("%s asks the server about the chat it is given, not the open one", async (action, mock) => {
    const { actions } = setup();

    await act(() => actions.current[action].mutateAsync("c42"));

    expect(mocks[mock]).toHaveBeenCalledWith("c42");
  });

  it("refreshes the inbox, the requests and the archived list afterwards", async () => {
    const { actions, invalidate } = setup();

    await act(() => actions.current.archive.mutateAsync("c1"));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "conversations"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "requests"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "archived"] });
  });

  it.each([["block"], ["archive"], ["unarchive"], ["remove"]])("%s tells onGone which chat left the list", async (action) => {
    const onGone = vi.fn();
    const { actions } = setup({ onGone });

    await act(() => actions.current[action].mutateAsync("c7"));

    expect(onGone).toHaveBeenCalledWith("c7");
  });

  it("tells onGone only after the lists have been refreshed", async () => {
    const order = [];
    const onGone = vi.fn(() => order.push("gone"));
    const { actions, invalidate } = setup({ onGone });
    invalidate.mockImplementation(async () => {
      await Promise.resolve();
      order.push("refreshed");
    });

    await act(() => actions.current.remove.mutateAsync("c1"));

    expect(order.at(-1)).toBe("gone");
    expect(order.filter((entry) => entry === "refreshed")).toHaveLength(3);
  });

  it("works without an onGone", async () => {
    const { actions } = setup();

    await expect(act(() => actions.current.block.mutateAsync("c1"))).resolves.not.toThrow();
  });

  it("does not refresh or call onGone when the server refuses", async () => {
    mocks.remove.mockRejectedValue(new Error("nope"));
    const onGone = vi.fn();
    const { actions, invalidate } = setup({ onGone });

    await act(() => actions.current.remove.mutateAsync("c1").catch(() => {}));

    expect(invalidate).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();
    await waitFor(() => expect(actions.current.remove.isError).toBe(true));
  });

  it("tracks each action on its own", async () => {
    mocks.block.mockReturnValue(new Promise(() => {}));
    const { actions } = setup();

    act(() => actions.current.block.mutate("c1"));

    await waitFor(() => expect(actions.current.block.isPending).toBe(true));
    expect(actions.current.archive.isPending).toBe(false);
    expect(actions.current.remove.isPending).toBe(false);
  });
});
