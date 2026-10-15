import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptPendingMessages: vi.fn(),
  getChatMessages: vi.fn(),
  markChatDelivered: vi.fn(),
  plaintextGet: vi.fn(),
  engine: { name: "engine" },
}));

vi.mock("../lib/chat/backgroundDecrypt", () => ({
  decryptPendingMessages: mocks.decryptPendingMessages,
}));
vi.mock("../lib/api", () => ({
  api: { getChatMessages: mocks.getChatMessages, markChatDelivered: mocks.markChatDelivered },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));
vi.mock("../lib/mls/storage/messagePlaintextStore", () => ({
  EncryptedIndexedDbMessagePlaintextStore: vi.fn().mockImplementation(function FakeStore() {
    return { get: mocks.plaintextGet };
  }),
}));
vi.mock("../hooks/chat/useSyncEngine", () => ({ useSyncEngine: () => mocks.engine }));
vi.mock("../hooks/chat/useDeviceIdentity", () => ({
  useDeviceIdentity: () => ({ credential: { deviceId: "device-me" } }),
}));

import { useBackgroundDecrypt } from "../hooks/chat/useBackgroundDecrypt";

const conversation = (id, extra = {}) => ({
  id,
  participantState: "ACTIVE",
  unreadCount: 2,
  lastMessage: { id: `${id}-last`, senderId: "peer", ciphertext: "x" },
  ...extra,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup(initial, openId = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ list, open }) => useBackgroundDecrypt(list, "me", open), {
    wrapper,
    initialProps: { list: initial, open: openId },
  });
}

describe("useBackgroundDecrypt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.plaintextGet.mockResolvedValue(undefined);
    mocks.getChatMessages.mockImplementation(async (id) => ({
      items: [{ id: `${id}-last` }],
    }));
    mocks.decryptPendingMessages.mockResolvedValue(undefined);
    mocks.markChatDelivered.mockResolvedValue({});
  });

  it("decrypts the messages of a conversation with something new from someone else", async () => {
    setup([conversation("c1")]);

    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1));
    expect(mocks.getChatMessages).toHaveBeenCalledWith("c1", { limit: 50 });
    expect(mocks.decryptPendingMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: mocks.engine,
        conversationId: "c1",
        messages: [{ id: "c1-last" }],
        ownDeviceId: "device-me",
        currentUserId: "me",
      }),
    );
  });

  it("tells the senders this device has their messages, skipping your own and unsent ones", async () => {
    mocks.getChatMessages.mockResolvedValue({
      items: [
        { id: "m1", senderId: "peer" },
        { id: "m2", senderId: "me" },
        { id: "m3", senderId: "peer", status: "DELETED" },
        { id: "m4", senderId: "peer" },
      ],
    });
    setup([conversation("c1")]);

    await waitFor(() => expect(mocks.markChatDelivered).toHaveBeenCalledWith(["m1", "m4"]));
    expect(mocks.markChatDelivered).toHaveBeenCalledTimes(1);
  });

  it("still decrypts when the delivery acknowledgement fails", async () => {
    mocks.markChatDelivered.mockRejectedValue(new Error("offline"));
    setup([conversation("c1")]);

    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1));
  });

  it("sends no acknowledgement when nothing came from someone else", async () => {
    mocks.getChatMessages.mockResolvedValue({ items: [{ id: "m1", senderId: "me" }] });
    setup([conversation("c1")]);

    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1));
    expect(mocks.markChatDelivered).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing is unread", { unreadCount: 0 }],
    ["the last message is your own", { lastMessage: { id: "m", senderId: "me", ciphertext: "x" } }],
    [
      "the last message was unsent",
      { lastMessage: { id: "m", senderId: "peer", status: "DELETED", ciphertext: "x" } },
    ],
    ["it is only a message request", { participantState: "PENDING" }],
    ["there is no message yet", { lastMessage: null }],
  ])("leaves a conversation alone when %s", async (_name, extra) => {
    setup([conversation("c1", extra)]);

    await settle();
    expect(mocks.getChatMessages).not.toHaveBeenCalled();
    expect(mocks.decryptPendingMessages).not.toHaveBeenCalled();
  });

  it("leaves the open conversation to the thread", async () => {
    setup([conversation("c1")], "c1");

    await settle();
    expect(mocks.decryptPendingMessages).not.toHaveBeenCalled();
  });

  it("does not fetch anything for a message that is already decrypted", async () => {
    mocks.plaintextGet.mockResolvedValue({ envelope: {} });
    setup([conversation("c1")]);

    await waitFor(() => expect(mocks.plaintextGet).toHaveBeenCalledWith("c1-last"));
    expect(mocks.getChatMessages).not.toHaveBeenCalled();
  });

  it("tries each newest message once, and a newer one again", async () => {
    const view = setup([conversation("c1")]);
    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1));

    view.rerender({ list: [conversation("c1")], open: "" });
    await settle();
    expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1);

    view.rerender({
      list: [
        conversation("c1", { lastMessage: { id: "c1-newer", senderId: "peer", ciphertext: "x" } }),
      ],
      open: "",
    });
    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(2));
  });

  it("works through conversations one at a time", async () => {
    let finishFirst = () => undefined;
    mocks.decryptPendingMessages.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve)),
    );
    setup([conversation("c1"), conversation("c2")]);

    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1));
    await settle();
    expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1);

    finishFirst();
    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(2));
  });

  it("carries on with the next conversation when one fails", async () => {
    mocks.getChatMessages.mockImplementation(async (id) => {
      if (id === "c1") throw new Error("offline");
      return { items: [{ id: `${id}-last` }] };
    });
    setup([conversation("c1"), conversation("c2")]);

    // The messages query retries once after a second before giving up on c1.
    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1), {
      timeout: 4000,
    });
    expect(mocks.decryptPendingMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c2" }),
    );
  });
});
