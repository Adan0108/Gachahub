import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityChat } from "../hooks/community/useCommunityChat";
import { useCommunityThread } from "../hooks/community/useCommunityThread";
import { setSharedSocket } from "../lib/socket/sharedSocket";

const mocks = vi.hoisted(() => ({
  api: {
    getCommunityChannels: vi.fn(),
    getCommunityMessages: vi.fn(),
    getCommunityMessage: vi.fn(),
    markCommunityRead: vi.fn(),
  },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { ...actual.api, ...mocks.api } };
});
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me", name: "Me" } }),
}));
vi.mock("../hooks/chat/useStickToBottom", () => ({
  useStickToBottom: () => ({
    onScroll: vi.fn(),
    scrollToBottom: vi.fn(),
    followIfNearBottom: vi.fn(),
    showJumpToBottom: false,
  }),
}));

const PAGE = 2;
const SECOND = 1000;
const at = (minute: any) => new Date(2026, 9, 16, 10, minute).toISOString();
const message = (id: any, extra = {}) => ({
  id,
  channelId: "c1",
  content: `text ${id}`,
  deleted: false,
  blocked: false,
  createdAt: at(Number(id.slice(1))),
  editedAt: null,
  author: { id: "ann", name: "Ann", image: null, badge: null },
  replyTo: null,
  media: [],
  mentions: [],
  reactions: [],
  ...extra,
});

/** A server holding these messages, oldest first, answering pages of PAGE like the real one. */
function serveRoom(initial: any) {
  const room = { all: initial.map((id: any) => message(id)) };
  mocks.api.getCommunityMessages.mockImplementation(async (_slug, _channel, { before } = {}) => {
    const end = before ? room.all.findIndex((item: any) => item.id === before) : room.all.length;
    const start = Math.max(0, end - PAGE);
    return { items: room.all.slice(start, end), hasMore: start > 0 };
  });
  return room;
}

function fakeSocket(connected = true) {
  const handlers = new Map();
  return {
    connected,
    emit: vi.fn(),
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    off: vi.fn((event) => handlers.delete(event)),
    fire: (event: any, payload?: any) => handlers.get(event)?.(payload),
  };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: any) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  // Both hooks in one component, as the screen has them: the thread re-renders on its own clock.
  return renderHook(
    () => {
      const chat = useCommunityChat("wuwa");
      useCommunityThread(chat);
      return chat;
    },
    { wrapper },
  );
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(400));
// One act per tick, so each re-render and its effects really happen in between.
const tick = async (seconds: any) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += 30) {
    await act(() => vi.advanceTimersByTimeAsync(30 * SECOND));
  }
};
const ids = (hook: any) => hook.result.current.messages.map((item: any) => item.id);
const pulls = () => mocks.api.getCommunityMessages.mock.calls.length;

async function open(roomIds: any, socket = fakeSocket()) {
  const room = serveRoom(roomIds);
  setSharedSocket(socket as any);
  const hook = setup();
  await settle();
  return { hook, room, socket };
}

describe("a community room staying in step with the server", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    mocks.api.getCommunityChannels.mockResolvedValue({
      channels: [{ id: "c1", name: "general", unreadCount: 0 }],
      canModerate: false,
      isMember: true,
    });
    mocks.api.markCommunityRead.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    setSharedSocket(null);
    vi.useRealTimers();
  });

  describe("while nothing is pushed", () => {
    it("still pulls every minute although the screen re-renders every 30 seconds", async () => {
      const { hook, socket } = await open(["m1", "m2"]);
      const before = pulls();
      socket.emit.mockClear();
      socket.off.mockClear();

      await tick(150);

      expect(ids(hook)).toEqual(["m1", "m2"]);
      expect(pulls() - before).toBe(2);
    });

    it("keeps its room subscription through those re-renders", async () => {
      const { socket } = await open(["m1", "m2"]);
      socket.emit.mockClear();
      socket.off.mockClear();

      await tick(150);

      expect(socket.emit).not.toHaveBeenCalled();
      expect(socket.off).not.toHaveBeenCalled();
    });

    it("checks every loaded page when the connection is down, since nothing says which message changed", async () => {
      const { hook, room, socket } = await open(["m1", "m2", "m3", "m4"]);
      socket.connected = false;
      await act(() => hook.result.current.loadOlder());
      await settle();
      expect(ids(hook)).toEqual(["m1", "m2", "m3", "m4"]);
      const before = pulls();

      room.all[0] = message("m1", { content: "edited while away" });
      await tick(60);

      expect(pulls() - before).toBe(2);
      expect(hook.result.current.messages[0]).toMatchObject({ content: "edited while away" });
    });
  });

  describe("after missing more than a page of messages", () => {
    it("keeps every message reachable when the connection comes back", async () => {
      const { hook, room, socket } = await open(["m1", "m2"]);

      room.all.push(...["m3", "m4", "m5", "m6"].map((id) => message(id)));
      act(() => socket.fire("connect"));
      await settle();

      expect(ids(hook)).toEqual(["m5", "m6"]);
      expect(hook.result.current.hasOlder).toBe(true);
      await act(() => hook.result.current.loadOlder());
      await settle();
      await act(() => hook.result.current.loadOlder());
      await settle();
      expect(ids(hook)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
      expect(hook.result.current.hasOlder).toBe(false);
    });

    it("keeps them reachable when a push shows a page that does not touch what was loaded", async () => {
      const { hook, room, socket } = await open(["m1", "m2"]);

      room.all.push(...["m3", "m4", "m5", "m6"].map((id) => message(id)));
      act(() => socket.fire("community:activity", { channelId: "c1", messageId: "m6" }));
      await settle();
      await act(() => hook.result.current.loadOlder());
      await settle();
      await act(() => hook.result.current.loadOlder());
      await settle();

      expect(ids(hook)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    });

    it("does not reload the pages when the new page joins up with what was loaded", async () => {
      const { hook, room, socket } = await open(["m1", "m2"]);
      const before = pulls();

      room.all.push(message("m3"));
      act(() => socket.fire("community:activity", { channelId: "c1", messageId: "m3" }));
      await settle();

      expect(pulls() - before).toBe(1);
      expect(ids(hook)).toEqual(["m1", "m2", "m3"]);
    });

    it("also counts a poll that jumped ahead", async () => {
      const { hook, room } = await open(["m1", "m2"]);

      room.all.push(...["m3", "m4", "m5", "m6"].map((id) => message(id)));
      await tick(60);
      await act(() => hook.result.current.loadOlder());
      await settle();
      await act(() => hook.result.current.loadOlder());
      await settle();

      expect(ids(hook)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    });
  });

  describe("when someone changes a message that is not in the newest page", () => {
    async function twoPagesLoaded() {
      const opened = await open(["m1", "m2", "m3", "m4"]);
      await act(() => opened.hook.result.current.loadOlder());
      await settle();
      expect(ids(opened.hook)).toEqual(["m1", "m2", "m3", "m4"]);
      return opened;
    }

    it("shows an edit", async () => {
      const { hook, socket } = await twoPagesLoaded();
      mocks.api.getCommunityMessage.mockResolvedValue(
        message("m1", { content: "fixed", editedAt: at(30) }),
      );
      const before = pulls();

      act(() => socket.fire("community:activity", { channelId: "c1", messageId: "m1" }));
      await settle();

      expect(mocks.api.getCommunityMessage).toHaveBeenCalledWith("wuwa", "m1");
      expect(hook.result.current.messages[0]).toMatchObject({ content: "fixed" });
      expect(pulls()).toBe(before);
    });

    it("shows a removal", async () => {
      const { hook, socket } = await twoPagesLoaded();
      mocks.api.getCommunityMessage.mockResolvedValue(
        message("m2", { content: null, deleted: true }),
      );

      act(() => socket.fire("community:activity", { channelId: "c1", messageId: "m2" }));
      await settle();

      expect(hook.result.current.messages[1]).toMatchObject({ id: "m2", deleted: true });
    });

    it("shows a reaction", async () => {
      const { hook, socket } = await twoPagesLoaded();
      const reactions = [{ id: "r1", emoji: "👍", userId: "bo", emote: null }];
      mocks.api.getCommunityMessage.mockResolvedValue(message("m1", { reactions }));

      act(() => socket.fire("community:activity", { channelId: "c1", messageId: "m1" }));
      await settle();

      expect(hook.result.current.messages[0]!.reactions).toEqual(reactions);
    });

    it("fetches each changed message once for a burst", async () => {
      const { socket } = await twoPagesLoaded();
      mocks.api.getCommunityMessage.mockImplementation(async (_slug, id) => message(id));

      act(() => {
        socket.fire("community:activity", { channelId: "c1", messageId: "m1" });
        socket.fire("community:activity", { channelId: "c1", messageId: "m1" });
        socket.fire("community:activity", { channelId: "c1", messageId: "m2" });
      });
      await settle();

      expect(mocks.api.getCommunityMessage.mock.calls.map(([, id]) => id)).toEqual(["m1", "m2"]);
    });

    it("pulls the newest page for a change without a message id, as an older server sends it", async () => {
      const { socket } = await twoPagesLoaded();
      const before = pulls();

      act(() => socket.fire("community:activity", { channelId: "c1" }));
      await settle();

      expect(pulls() - before).toBe(1);
      expect(mocks.api.getCommunityMessage).not.toHaveBeenCalled();
    });
  });
});
