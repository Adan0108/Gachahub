import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSend } from "../hooks/chat/useChatSend";
import { SEND_LIMIT } from "../lib/chat/messageLimits";

const mocks = vi.hoisted(() => ({ send: vi.fn(), addToCache: vi.fn() }));
vi.mock("../lib/mls/messaging/sendEncryptedMessage", () => ({
  sendEncryptedChatMessage: mocks.send,
}));
vi.mock("../lib/chat/messageCache", () => ({ addMessageToCache: mocks.addToCache }));

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(
    () =>
      useChatSend({
        conversationId: "c1",
        syncEngine: {} as never,
        deviceId: "dev1",
        recipientIds: () => "bob",
        withDeviceRecovery: (action) => action(),
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

const draft = (text: string) => ({ text, files: [] });

describe("useChatSend", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.addToCache.mockReset();
  });

  it("shows the message as pending, then puts the sent one in the thread", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.send.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = setup();

    act(() => {
      result.current.send(draft("hi"));
    });
    expect(result.current.pendingMessages).toMatchObject([{ text: "hi", conversationId: "c1" }]);

    await act(async () => finish({ message: { id: "m1" } }));

    await waitFor(() => expect(result.current.pendingMessages).toEqual([]));
    expect(mocks.addToCache).toHaveBeenCalledWith(expect.anything(), "c1", { id: "m1" });
  });

  it("refuses, sending nothing, once the cooldown starts", async () => {
    mocks.send.mockResolvedValue({ message: { id: "m" } });
    const { result } = setup();

    const accepted: boolean[] = [];
    act(() => {
      for (let i = 0; i <= SEND_LIMIT; i += 1) accepted.push(result.current.send(draft(`${i}`)));
    });

    expect(accepted.filter(Boolean)).toHaveLength(SEND_LIMIT);
    expect(accepted.at(-1)).toBe(false);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(SEND_LIMIT));
  });

  it("marks a failed send, and a retry sends it again with the same client id and reply", async () => {
    mocks.send
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue({ message: { id: "m1" } });
    const { result } = setup();

    act(() => {
      result.current.send({ ...draft("hi"), replyToId: "r1" });
    });
    await waitFor(() => expect(result.current.pendingMessages[0]?.failed).toBe(true));

    act(() => result.current.retry(result.current.pendingMessages[0]!));

    await waitFor(() => expect(result.current.pendingMessages).toEqual([]));
    const [first, retried] = mocks.send.mock.calls.map(([params]) => params);
    expect(retried.clientMessageId).toBe(first.clientMessageId);
    expect(retried.replyToId).toBe("r1");
  });
});
