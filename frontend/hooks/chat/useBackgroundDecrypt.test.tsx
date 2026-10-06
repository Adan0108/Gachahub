// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptPendingMessages: vi.fn(),
  getChatMessages: vi.fn(),
  plaintextGet: vi.fn(),
  engine: { name: "engine" },
}));

vi.mock("../../lib/chat/backgroundDecrypt", () => ({
  decryptPendingMessages: mocks.decryptPendingMessages,
}));
vi.mock("../../lib/api", () => ({
  api: { getChatMessages: mocks.getChatMessages },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));
vi.mock("../../lib/mls/storage/messagePlaintextStore", () => ({
  EncryptedIndexedDbMessagePlaintextStore: vi.fn().mockImplementation(function FakeStore() {
    return { get: mocks.plaintextGet };
  }),
}));
vi.mock("./useSyncEngine", () => ({ useSyncEngine: vi.fn(() => mocks.engine) }));
vi.mock("./useDeviceIdentity", () => ({
  useDeviceIdentity: () => ({ credential: { deviceId: "device-me" } }),
}));

import { useBackgroundDecrypt } from "./useBackgroundDecrypt";

const conversation = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  participantState: "ACTIVE",
  unreadCount: 2,
  lastMessage: { id: `${id}-last`, senderId: "peer", ciphertext: "x" },
  ...extra,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup(initial: unknown[], openId = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ list, open }: { list: unknown[]; open: string }) =>
      useBackgroundDecrypt(list as never, "me", open),
    { wrapper, initialProps: { list: initial, open: openId } },
  );
}

describe("useBackgroundDecrypt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.plaintextGet.mockResolvedValue(undefined);
    mocks.getChatMessages.mockImplementation(async (id: string) => ({
      items: [{ id: `${id}-last` }],
    }));
    mocks.decryptPendingMessages.mockResolvedValue(undefined);
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

  it.each<[string, Record<string, unknown>]>([
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
    let finishFirst: () => void = () => undefined;
    mocks.decryptPendingMessages.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishFirst = resolve)),
    );
    setup([conversation("c1"), conversation("c2")]);

    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1));
    await settle();
    expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1);

    finishFirst();
    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(2));
  });

  it("carries on with the next conversation when one fails", async () => {
    mocks.getChatMessages.mockRejectedValueOnce(new Error("offline"));
    setup([conversation("c1"), conversation("c2")]);

    await waitFor(() => expect(mocks.decryptPendingMessages).toHaveBeenCalledTimes(1));
    expect(mocks.decryptPendingMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c2" }),
    );
  });
});
