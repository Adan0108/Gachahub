import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationActions } from "../hooks/chat/useConversationActions";

const mocks = vi.hoisted(() => ({
  block: vi.fn(),
  unblock: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    blockChatConversation: mocks.block,
    unblockChatUser: mocks.unblock,
    archiveChatConversation: mocks.archive,
    unarchiveChatConversation: mocks.unarchive,
    deleteChatConversation: mocks.remove,
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

function setup(options?: any) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: any) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useConversationActions(options), { wrapper });
  return { actions: result, invalidate, client };
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

    await act(() => (actions.current as any)[action].mutateAsync("c42"));

    expect((mocks as any)[mock]).toHaveBeenCalledWith("c42");
  });

  it("refreshes the inbox, the requests, the archived and the blocked list afterwards", async () => {
    const { actions, invalidate } = setup();

    await act(() => actions.current.archive.mutateAsync("c1"));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "conversations"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "requests"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "archived"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "blocked"] });
  });

  it.each([["archive"], ["unarchive"], ["remove"]])("%s tells onGone which chat left the list", async (action) => {
    const onGone = vi.fn();
    const { actions } = setup({ onGone });

    await act(() => (actions.current as any)[action].mutateAsync("c7"));

    expect(onGone).toHaveBeenCalledWith("c7");
  });

  it("block and unblock refresh the lists but never say a chat left: it stays in the list", async () => {
    const onGone = vi.fn();
    const { actions, invalidate } = setup({ onGone });

    await act(() => actions.current.block.mutateAsync("c7"));
    await act(() => actions.current.unblock.mutateAsync("user-9"));

    expect(mocks.unblock).toHaveBeenCalledWith("user-9");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "conversations"] });
    expect(onGone).not.toHaveBeenCalled();
  });

  it("tells onGone only once the server has agreed", async () => {
    let finish = () => {};
    mocks.remove.mockReturnValue(new Promise((resolve) => (finish = () => resolve({}))));
    const onGone = vi.fn();
    const { actions } = setup({ onGone });

    act(() => actions.current.remove.mutate("c1"));
    expect(onGone).not.toHaveBeenCalled();
    await act(async () => finish());

    await waitFor(() => expect(onGone).toHaveBeenCalledWith("c1"));
  });

  it("works without an onGone", async () => {
    const { actions } = setup();

    await expect(act(() => actions.current.block.mutateAsync("c1"))).resolves.not.toThrow();
  });

  it("does not call onGone when the server refuses", async () => {
    mocks.remove.mockRejectedValue(new Error("nope"));
    const onGone = vi.fn();
    const { actions } = setup({ onGone });

    await act(() => actions.current.remove.mutateAsync("c1").catch(() => {}));

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

  describe("at once, before the server answers", () => {
    const direct = (id: any, peerBlocked = false) => ({
      id,
      type: "DIRECT",
      participants: [
        { userId: "me", isMuted: false },
        { userId: `peer-${id}`, isBlockedByMe: peerBlocked },
      ],
    });
    const never = () => new Promise(() => {});
    const lists = (client: any) => ({
      inbox: client.getQueryData(["chat", "conversations"]),
      archived: client.getQueryData(["chat", "archived"]),
      requests: client.getQueryData(["chat", "requests"]),
    });

    function setupLists(options?: any) {
      const view = setup({ userId: "me", ...options });
      view.client.setQueryData(["chat", "conversations"], [direct("c1"), direct("c2")]);
      view.client.setQueryData(["chat", "archived"], [direct("c3")]);
      view.client.setQueryData(["chat", "requests"], [direct("c4")]);
      return view;
    }

    it("marks the other person blocked, keeps the chat in the list, and says so", async () => {
      mocks.block.mockReturnValue(never());
      const notify = vi.fn();
      const { actions, client } = setupLists({ notify });

      act(() => actions.current.block.mutate("c1"));

      await waitFor(() => expect(notify).toHaveBeenCalledWith("Blocked."));
      const inbox = lists(client).inbox;
      expect(inbox.map((chat: any) => chat.id)).toEqual(["c1", "c2"]);
      expect(inbox[0].participants[1].isBlockedByMe).toBe(true);
      expect(inbox[1].participants[1].isBlockedByMe).toBe(false);
    });

    it("takes a blocked request out of the requests", async () => {
      mocks.block.mockReturnValue(never());
      const { actions, client } = setupLists();

      act(() => actions.current.block.mutate("c4"));

      await waitFor(() => expect(lists(client).requests).toEqual([]));
    });

    it("marks the person unblocked everywhere, and says so", async () => {
      mocks.unblock.mockReturnValue(never());
      const notify = vi.fn();
      const { actions, client } = setup({ userId: "me", notify });
      client.setQueryData(["chat", "conversations"], [direct("c1", true)]);

      act(() => actions.current.unblock.mutate("peer-c1"));

      await waitFor(() => expect(notify).toHaveBeenCalledWith("Unblocked."));
      expect(lists(client).inbox[0].participants[1].isBlockedByMe).toBe(false);
    });

    it("takes the person off the Blocked list when they are unblocked", async () => {
      mocks.unblock.mockReturnValue(never());
      const { actions, client } = setup({ userId: "me" });
      client.setQueryData(["chat", "blocked"], {
        items: [{ id: "bo", name: "Bo" }, { id: "cy", name: "Cy" }],
      });

      act(() => actions.current.unblock.mutate("bo"));

      await waitFor(() =>
        expect(client.getQueryData<any>(["chat", "blocked"]).items.map((person: any) => person.id)).toEqual(["cy"]),
      );
    });

    it("moves a chat out of the inbox when it is archived, and out of the archive when it is not", async () => {
      mocks.archive.mockReturnValue(never());
      mocks.unarchive.mockReturnValue(never());
      const notify = vi.fn();
      const { actions, client } = setupLists({ notify });

      act(() => actions.current.archive.mutate("c1"));
      await waitFor(() => expect(lists(client).inbox.map((chat: any) => chat.id)).toEqual(["c2"]));
      expect(notify).toHaveBeenCalledWith("Chat archived.");

      act(() => actions.current.unarchive.mutate("c3"));
      await waitFor(() => expect(lists(client).archived).toEqual([]));
      expect(notify).toHaveBeenCalledWith("Moved back to your inbox.");
    });

    it("drops a deleted chat from every list, and says so", async () => {
      mocks.remove.mockReturnValue(never());
      const notify = vi.fn();
      const { actions, client } = setupLists({ notify });

      act(() => actions.current.remove.mutate("c3"));

      await waitFor(() => expect(notify).toHaveBeenCalledWith("Chat deleted."));
      expect(lists(client).archived).toEqual([]);
      expect(lists(client).inbox).toHaveLength(2);
    });

    it("puts the lists back and says so when the server refuses", async () => {
      mocks.archive.mockRejectedValue(new Error("nope"));
      const notify = vi.fn();
      const { actions, client } = setupLists({ notify });

      await act(() => actions.current.archive.mutateAsync("c1").catch(() => {}));

      await waitFor(() => expect(notify).toHaveBeenLastCalledWith("Couldn't archive. Try again."));
      expect(lists(client).inbox.map((chat: any) => chat.id)).toEqual(["c1", "c2"]);
    });

    it("asks the server for the truth once it has answered, either way", async () => {
      mocks.archive.mockRejectedValue(new Error("nope"));
      const { actions, invalidate } = setupLists();

      await act(() => actions.current.archive.mutateAsync("c1").catch(() => {}));

      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "conversations"] }));
    });
  });
});
