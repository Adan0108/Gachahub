import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityChat } from "../hooks/community/useCommunityChat";
import { setSharedSocket } from "../lib/socket/sharedSocket";

const mocks = vi.hoisted(() => ({
  api: {
    getCommunityChannels: vi.fn(),
    getCommunityMessages: vi.fn(),
    sendCommunityMessage: vi.fn(),
    editCommunityMessage: vi.fn(),
    removeCommunityMessage: vi.fn(),
    reactToCommunityMessage: vi.fn(),
    unreactToCommunityMessage: vi.fn(),
    markCommunityRead: vi.fn(),
    uploadSingleImage: vi.fn(),
  },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { ...actual.api, ...mocks.api } };
});
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me", name: "Me" } }),
}));

const CHANNEL = { id: "c1", name: "general", unreadCount: 0 };
const at = (minute) => new Date(2026, 9, 16, 10, minute).toISOString();
const message = (id, minute, extra = {}) => ({
  id,
  channelId: "c1",
  content: `text ${id}`,
  deleted: false,
  blocked: false,
  createdAt: at(minute),
  editedAt: null,
  author: { id: "ann", name: "Ann", image: null, badge: null },
  replyTo: null,
  media: [],
  mentions: [],
  reactions: [],
  ...extra,
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCommunityChat("wuwa"), { wrapper });
  return { ...hook, client };
}

const loaded = async (hook) => {
  await waitFor(() => expect(hook.result.current.messages.length).toBeGreaterThan(0));
  return hook;
};

describe("useCommunityChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.getCommunityChannels.mockResolvedValue({
      channels: [CHANNEL],
      canModerate: false,
      isMember: true,
    });
    mocks.api.getCommunityMessages.mockResolvedValue({
      items: [message("m1", 1), message("m2", 2)],
      hasMore: false,
    });
    mocks.api.markCommunityRead.mockResolvedValue({ ok: true });
  });

  it("loads the room and its newest messages, oldest first", async () => {
    const hook = await loaded(setup());

    expect(hook.result.current.channel).toMatchObject({ id: "c1", name: "general" });
    expect(hook.result.current.messages.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(mocks.api.getCommunityMessages).toHaveBeenCalledWith("wuwa", "c1", {
      before: undefined,
      limit: 50,
    });
  });

  it("says the viewer must join when the server refuses with 403, without calling it an error", async () => {
    mocks.api.getCommunityChannels.mockRejectedValue(
      Object.assign(new Error("Join"), { status: 403 }),
    );
    const { result } = setup();

    await waitFor(() => expect(result.current.needsToJoin).toBe(true));

    expect(result.current.error).toBeNull();
    expect(mocks.api.getCommunityMessages).not.toHaveBeenCalled();
  });

  it("reports a real failure", async () => {
    mocks.api.getCommunityChannels.mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 }),
    );
    const { result } = setup();

    await waitFor(() => expect(result.current.error).toMatchObject({ message: "boom" }));
    expect(result.current.needsToJoin).toBe(false);
  });

  it("loads the page before the oldest message when asked", async () => {
    mocks.api.getCommunityMessages
      .mockResolvedValueOnce({ items: [message("m3", 3), message("m4", 4)], hasMore: true })
      .mockResolvedValue({ items: [message("m1", 1), message("m2", 2)], hasMore: false });
    const hook = await loaded(setup());
    await waitFor(() => expect(hook.result.current.hasOlder).toBe(true));

    await act(() => hook.result.current.loadOlder());

    await waitFor(() =>
      expect(hook.result.current.messages.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4"]),
    );
    expect(mocks.api.getCommunityMessages).toHaveBeenCalledWith("wuwa", "c1", {
      before: "m3",
      limit: 50,
    });
    expect(hook.result.current.hasOlder).toBe(false);
  });

  describe("sending", () => {
    it("shows the message as sending, then puts the sent one in the room", async () => {
      let finish;
      mocks.api.sendCommunityMessage.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const hook = await loaded(setup());

      act(() => {
        hook.result.current.send("hello", null);
      });

      expect(hook.result.current.pending).toMatchObject([{ content: "hello", status: "sending" }]);
      await act(async () =>
        finish(
          message("m3", 3, {
            content: "hello",
            author: { id: "me", name: "Me", image: null, badge: null },
          }),
        ),
      );

      await waitFor(() => expect(hook.result.current.pending).toEqual([]));
      expect(hook.result.current.messages.at(-1)).toMatchObject({ id: "m3", content: "hello" });
    });

    it("sends the reply target and a client id that stays the same on retry", async () => {
      mocks.api.sendCommunityMessage.mockRejectedValueOnce(new Error("Network down"));
      mocks.api.sendCommunityMessage.mockResolvedValue(message("m3", 3));
      const hook = await loaded(setup());

      await act(() => hook.result.current.send("hello", { id: "m1" }));
      await waitFor(() => expect(hook.result.current.pending[0].status).toBe("failed"));
      expect(hook.result.current.pending[0].error).toBe("Network down");

      await act(() => hook.result.current.retry(hook.result.current.pending[0].clientId));

      const [first, second] = mocks.api.sendCommunityMessage.mock.calls.map(
        ([, , payload]) => payload,
      );
      expect(first).toMatchObject({ content: "hello", replyToId: "m1" });
      expect(second.clientMessageId).toBe(first.clientMessageId);
      await waitFor(() => expect(hook.result.current.pending).toEqual([]));
    });

    describe("with pictures", () => {
      const file = (name) => new File(["x"], name, { type: "image/png" });

      it("uploads them as community pictures, then sends their ids in the order picked", async () => {
        mocks.api.uploadSingleImage.mockImplementation(async (picked) => ({
          mediaUploadId: `up-${picked.name}`,
        }));
        mocks.api.sendCommunityMessage.mockResolvedValue(message("m3", 3));
        const hook = await loaded(setup());

        await act(() => hook.result.current.send("", null, [file("a.png"), file("b.png")]));

        expect(mocks.api.uploadSingleImage).toHaveBeenCalledWith(expect.any(File), "COMMUNITY");
        expect(mocks.api.sendCommunityMessage.mock.calls[0][2]).toMatchObject({
          content: "",
          mediaUploadIds: ["up-a.png", "up-b.png"],
        });
        await waitFor(() => expect(hook.result.current.pending).toEqual([]));
      });

      it("sends a message without pictures exactly as before", async () => {
        mocks.api.sendCommunityMessage.mockResolvedValue(message("m3", 3));
        const hook = await loaded(setup());

        await act(() => hook.result.current.send("hello", null));

        expect(mocks.api.uploadSingleImage).not.toHaveBeenCalled();
        expect(mocks.api.sendCommunityMessage.mock.calls[0][2]).not.toHaveProperty("mediaUploadIds");
      });

      it("fails the message when a picture does not upload, and sends nothing", async () => {
        mocks.api.uploadSingleImage.mockRejectedValue(new Error("Image must be 10 MB or smaller"));
        const hook = await loaded(setup());

        await act(() => hook.result.current.send("look", null, [file("a.png")]));

        await waitFor(() => expect(hook.result.current.pending[0].status).toBe("failed"));
        expect(hook.result.current.pending[0].error).toBe("Image must be 10 MB or smaller");
        expect(mocks.api.sendCommunityMessage).not.toHaveBeenCalled();
      });

      it("uploads only the pictures that failed when retried, and keeps the same client id", async () => {
        mocks.api.uploadSingleImage.mockImplementation(async (picked) => {
          if (picked.name === "b.png" && mocks.api.uploadSingleImage.mock.calls.length <= 2) {
            throw new Error("Upload failed");
          }
          return { mediaUploadId: `up-${picked.name}` };
        });
        mocks.api.sendCommunityMessage.mockResolvedValue(message("m3", 3));
        const hook = await loaded(setup());

        await act(() => hook.result.current.send("two", null, [file("a.png"), file("b.png")]));
        await waitFor(() => expect(hook.result.current.pending[0].status).toBe("failed"));
        await act(() => hook.result.current.retry(hook.result.current.pending[0].clientId));

        const uploaded = mocks.api.uploadSingleImage.mock.calls.map(([picked]) => picked.name);
        expect(uploaded).toEqual(["a.png", "b.png", "b.png"]);
        expect(mocks.api.sendCommunityMessage.mock.calls[0][2].mediaUploadIds).toEqual([
          "up-a.png",
          "up-b.png",
        ]);
        await waitFor(() => expect(hook.result.current.pending).toEqual([]));
      });

      it("does not upload again when only the send failed", async () => {
        mocks.api.uploadSingleImage.mockResolvedValue({ mediaUploadId: "up1" });
        mocks.api.sendCommunityMessage.mockRejectedValueOnce(new Error("Network down"));
        mocks.api.sendCommunityMessage.mockResolvedValue(message("m3", 3));
        const hook = await loaded(setup());

        await act(() => hook.result.current.send("", null, [file("a.png")]));
        await waitFor(() => expect(hook.result.current.pending[0].status).toBe("failed"));
        await act(() => hook.result.current.retry(hook.result.current.pending[0].clientId));

        expect(mocks.api.uploadSingleImage).toHaveBeenCalledTimes(1);
        const [first, second] = mocks.api.sendCommunityMessage.mock.calls.map(([, , body]) => body);
        expect(second.mediaUploadIds).toEqual(first.mediaUploadIds);
        expect(second.clientMessageId).toBe(first.clientMessageId);
      });
    });

    it("drops a failed message when discarded", async () => {
      mocks.api.sendCommunityMessage.mockRejectedValue(new Error("nope"));
      const hook = await loaded(setup());
      await act(() => hook.result.current.send("hello", null));
      await waitFor(() => expect(hook.result.current.pending[0].status).toBe("failed"));

      act(() => hook.result.current.discard(hook.result.current.pending[0].clientId));

      expect(hook.result.current.pending).toEqual([]);
    });

    it("does not show a message twice when the poll already brought it in", async () => {
      mocks.api.sendCommunityMessage.mockResolvedValue(message("m2", 2));
      const hook = await loaded(setup());

      await act(() => hook.result.current.send("again", null));

      await waitFor(() => expect(hook.result.current.pending).toEqual([]));
      expect(hook.result.current.messages.filter((item) => item.id === "m2")).toHaveLength(1);
    });
  });

  it("edits, then shows the edited message", async () => {
    mocks.api.editCommunityMessage.mockResolvedValue(
      message("m1", 1, { content: "fixed", editedAt: at(5) }),
    );
    const hook = await loaded(setup());

    await act(() => hook.result.current.edit.mutateAsync({ messageId: "m1", content: "fixed" }));

    expect(mocks.api.editCommunityMessage).toHaveBeenCalledWith("wuwa", "m1", "fixed");
    await waitFor(() =>
      expect(hook.result.current.messages[0]).toMatchObject({ content: "fixed", editedAt: at(5) }),
    );
  });

  it("removes, then shows the message as removed", async () => {
    mocks.api.removeCommunityMessage.mockResolvedValue(
      message("m1", 1, { content: null, deleted: true }),
    );
    const hook = await loaded(setup());

    await act(() => hook.result.current.remove.mutateAsync({ messageId: "m1", reason: "spam" }));

    expect(mocks.api.removeCommunityMessage).toHaveBeenCalledWith("wuwa", "m1", "spam");
    await waitFor(() =>
      expect(hook.result.current.messages[0]).toMatchObject({ deleted: true, content: null }),
    );
  });

  describe("reactions", () => {
    it("shows my reaction at once, then keeps what the server answers", async () => {
      let finish;
      mocks.api.reactToCommunityMessage.mockReturnValue(
        new Promise((resolve) => (finish = resolve)),
      );
      const hook = await loaded(setup());

      act(() => {
        hook.result.current.react.mutate({
          messageId: "m1",
          choice: { kind: "emoji", emoji: "👍" },
        });
      });

      await waitFor(() =>
        expect(hook.result.current.messages[0].reactions).toEqual([{ userId: "me", emoji: "👍" }]),
      );
      await act(async () =>
        finish({
          id: "m1",
          reactions: [
            { userId: "me", emoji: "👍", emoteId: null, emote: null },
            { userId: "bo", emoji: "🎉", emoteId: null, emote: null },
          ],
        }),
      );
      // the answer carries reactions alone, so the rest of the message stays as it was
      await waitFor(() => expect(hook.result.current.messages[0].reactions).toHaveLength(2));
      expect(hook.result.current.messages[0]).toMatchObject({ id: "m1", content: "text m1" });
      expect(mocks.api.reactToCommunityMessage).toHaveBeenCalledWith("wuwa", "m1", {
        kind: "emoji",
        emoji: "👍",
      });
    });

    it("puts the reactions back when the server refuses", async () => {
      mocks.api.reactToCommunityMessage.mockRejectedValue(new Error("no"));
      const hook = await loaded(setup());

      await act(() =>
        hook.result.current.react
          .mutateAsync({ messageId: "m1", choice: { kind: "emoji", emoji: "👍" } })
          .catch(() => {}),
      );

      await waitFor(() => expect(hook.result.current.messages[0].reactions).toEqual([]));
    });

    it("takes a reaction back with a null choice", async () => {
      mocks.api.unreactToCommunityMessage.mockResolvedValue({ id: "m1", reactions: [] });
      const hook = await loaded(setup());

      await act(() => hook.result.current.react.mutateAsync({ messageId: "m1", choice: null }));

      expect(mocks.api.unreactToCommunityMessage).toHaveBeenCalledWith("wuwa", "m1");
    });
  });

  it("marks the room read up to a message and refreshes the unread counts", async () => {
    const hook = await loaded(setup());
    const before = mocks.api.getCommunityChannels.mock.calls.length;

    act(() => hook.result.current.markRead("m2"));

    await waitFor(() =>
      expect(mocks.api.getCommunityChannels.mock.calls.length).toBeGreaterThan(before),
    );
    expect(mocks.api.markCommunityRead).toHaveBeenCalledWith("wuwa", "c1", "m2");
  });

  describe("live updates", () => {
    function fakeSocket(connected = true) {
      const handlers = new Map();
      return {
        connected,
        emit: vi.fn(),
        on: vi.fn((event, handler) => handlers.set(event, handler)),
        off: vi.fn((event) => handlers.delete(event)),
        fire: (event, payload) => handlers.get(event)?.(payload),
      };
    }
    const pulls = () => mocks.api.getCommunityMessages.mock.calls.length;

    afterEach(() => setSharedSocket(null));

    it("listens to its room once the messages have loaded", async () => {
      const socket = fakeSocket();
      setSharedSocket(socket);

      await loaded(setup());

      expect(socket.emit).toHaveBeenCalledWith("community:join", { slug: "wuwa", channelId: "c1" });
    });

    it("pulls the newest page when its room changes, once for a burst", async () => {
      const socket = fakeSocket();
      setSharedSocket(socket);
      await loaded(setup());
      const before = pulls();

      act(() => {
        socket.fire("community:activity", { channelId: "c1" });
        socket.fire("community:activity", { channelId: "c1" });
      });

      await waitFor(() => expect(pulls()).toBe(before + 1));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(pulls()).toBe(before + 1);
    });

    it("shows what the pull brings, such as a message from someone else", async () => {
      const socket = fakeSocket();
      setSharedSocket(socket);
      const hook = await loaded(setup());
      mocks.api.getCommunityMessages.mockResolvedValue({
        items: [message("m1", 1), message("m2", 2), message("m3", 3)],
        hasMore: false,
      });

      act(() => socket.fire("community:activity", { channelId: "c1" }));

      await waitFor(() => expect(hook.result.current.messages.map((item) => item.id)).toContain("m3"));
    });

    it("ignores a change in another room", async () => {
      const socket = fakeSocket();
      setSharedSocket(socket);
      await loaded(setup());
      const before = pulls();

      act(() => socket.fire("community:activity", { channelId: "other" }));
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(pulls()).toBe(before);
    });

    it("joins again and catches up after the connection comes back", async () => {
      const socket = fakeSocket();
      setSharedSocket(socket);
      await loaded(setup());
      const before = pulls();
      socket.emit.mockClear();

      act(() => socket.fire("connect"));

      expect(socket.emit).toHaveBeenCalledWith("community:join", { slug: "wuwa", channelId: "c1" });
      await waitFor(() => expect(pulls()).toBe(before + 1));
    });

    it("leaves the room and stops listening when the chat closes", async () => {
      const socket = fakeSocket();
      setSharedSocket(socket);
      const hook = await loaded(setup());

      hook.unmount();

      expect(socket.emit).toHaveBeenCalledWith("community:leave", { channelId: "c1" });
      expect(socket.off).toHaveBeenCalledWith("community:activity", expect.any(Function));
    });
  });
});
