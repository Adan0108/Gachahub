import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHARE_RESULT, usePostShare } from "../hooks/chat/usePostShare";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  api: {
    getChatConversations: vi.fn(),
    getChatRequests: vi.fn(),
    getArchivedChatConversations: vi.fn(),
    createDirectMessage: vi.fn(),
  },
  identity: {
    credential: { deviceId: "dev1" },
    isReady: true,
    error: undefined,
    reprovision: vi.fn(),
  },
  engine: { name: "engine" },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { ...actual.api, ...mocks.api } };
});
vi.mock("../lib/mls/messaging/sendPostShare", () => ({ sendEncryptedPostShare: mocks.send }));
vi.mock("../hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
vi.mock("../hooks/chat/useDeviceIdentity", () => ({ useDeviceIdentity: () => mocks.identity }));
vi.mock("../hooks/chat/useSyncEngine", () => ({ useSyncEngine: () => mocks.engine }));

const person = (id: any, state = "ACTIVE") => ({
  userId: id,
  state,
  user: { id, name: id, image: null },
});
const dm = (id: any, other: any, otherState = "ACTIVE") => ({
  id,
  type: "DIRECT",
  participants: [person("me"), person(other, otherState)],
});
const SHARE = { postId: "cm123abc", caption: "look" };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: any) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => usePostShare(), { wrapper });
  return { ...hook, invalidate };
}

describe("usePostShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.isReady = true;
    mocks.api.getChatConversations.mockResolvedValue([]);
    mocks.api.getChatRequests.mockResolvedValue([]);
    mocks.api.getArchivedChatConversations.mockResolvedValue([]);
    mocks.send.mockResolvedValue({ message: { id: "m1" } });
  });

  it("can send once this device's encryption is ready", () => {
    expect(setup().result.current.canSend).toBe(true);

    mocks.identity.isReady = false;
    expect(setup().result.current.canSend).toBe(false);
  });

  it("sends into a chat you have, to everyone else in it", async () => {
    const { result, invalidate } = setup();
    const conversation = dm("c1", "bob");

    const outcome = await result.current.sendTo({ key: "chat:c1", conversation }, SHARE);

    expect(outcome).toEqual({ status: SHARE_RESULT.SENT });
    expect(mocks.send).toHaveBeenCalledWith(
      mocks.engine,
      "dev1",
      "c1",
      ["bob"],
      SHARE,
      expect.any(String),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "messages", "c1"] });
  });

  it("does not send into a chat nobody can receive in yet", async () => {
    const { result } = setup();

    const outcome = await result.current.sendTo(
      { key: "chat:c1", conversation: dm("c1", "bob", "PENDING") },
      SHARE,
    );

    expect(outcome).toEqual({ status: SHARE_RESULT.WAITING, reason: "Waiting for them to accept" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("uses the chat that already exists with a person instead of starting another", async () => {
    mocks.api.getArchivedChatConversations.mockResolvedValue([dm("c9", "cara")]);
    const { result } = setup();

    const outcome = await result.current.sendTo(
      { key: "person:cara", person: { id: "cara", name: "Cara" } },
      SHARE,
    );

    expect(outcome.status).toBe(SHARE_RESULT.SENT);
    expect(mocks.api.createDirectMessage).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0]![2]).toBe("c9");
  });

  it("starts a chat with someone new and sends into it", async () => {
    mocks.api.createDirectMessage.mockResolvedValue({
      conversationId: "cNew",
      recipientState: "ACTIVE",
    });
    const { result } = setup();

    const outcome = await result.current.sendTo(
      { key: "person:dan", person: { id: "dan", name: "Dan" } },
      SHARE,
    );

    expect(outcome.status).toBe(SHARE_RESULT.SENT);
    expect(mocks.api.createDirectMessage).toHaveBeenCalledWith({
      recipientUserId: "dan",
      message: { ciphertext: "placeholder-pending-mls-setup", contentType: "SYSTEM" },
    });
    expect(mocks.send).toHaveBeenCalledWith(
      mocks.engine,
      "dev1",
      "cNew",
      ["dan"],
      SHARE,
      expect.any(String),
    );
  });

  it("only sends a message request to someone who does not follow you back, and says to share again", async () => {
    mocks.api.createDirectMessage.mockResolvedValue({
      conversationId: "cNew",
      recipientState: "PENDING",
    });
    const { result } = setup();

    const outcome = await result.current.sendTo(
      { key: "person:dan", person: { id: "dan", name: "Dan" } },
      SHARE,
    );

    expect(outcome).toEqual({ status: SHARE_RESULT.REQUESTED });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("reports a failure with its reason, and a retry reuses the same client id", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Network down"));
    const { result } = setup();
    const target = { key: "chat:c1", conversation: dm("c1", "bob") };

    const failed = await result.current.sendTo(target, SHARE);
    const retried = await result.current.sendTo(target, SHARE);

    expect(failed).toEqual({ status: SHARE_RESULT.FAILED, reason: "Network down" });
    expect(retried.status).toBe(SHARE_RESULT.SENT);
    expect(mocks.send.mock.calls[0]![5]).toBe(mocks.send.mock.calls[1]![5]);
  });

  it("uses a new client id for the next send of the same post to the same chat", async () => {
    const { result } = setup();
    const target = { key: "chat:c1", conversation: dm("c1", "bob") };

    await result.current.sendTo(target, SHARE);
    await result.current.sendTo(target, SHARE);

    expect(mocks.send.mock.calls[0]![5]).not.toBe(mocks.send.mock.calls[1]![5]);
  });
});
