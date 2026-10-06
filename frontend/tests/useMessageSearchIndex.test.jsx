import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageSearchIndex } from "../hooks/chat/useMessageSearchIndex";

const mocks = vi.hoisted(() => ({ saved: new Set(), stored: [] }));

vi.mock("../lib/mls/storage/messagePlaintextStore", () => ({
  EncryptedIndexedDbMessagePlaintextStore: class {
    async listIds() {
      return mocks.stored.map((message) => message.messageId);
    }
    async get(id) {
      return mocks.stored.find((message) => message.messageId === id);
    }
  },
  onMessageSaved: (listener) => {
    mocks.saved.add(listener);
    return () => mocks.saved.delete(listener);
  },
  onMessageRemoved: () => () => {},
}));

const message = (messageId, body) => ({
  messageId,
  conversationId: "c1",
  senderDeviceId: "d1",
  epoch: 1,
  envelope: { v: 1, type: "text", body },
});

describe("useMessageSearchIndex", () => {
  beforeEach(() => {
    mocks.stored = [message("m1", "hello there")];
  });

  it("stays idle and listens to nothing while disabled", () => {
    const { result } = renderHook(() => useMessageSearchIndex(false));

    expect(result.current.status).toBe("idle");
    expect(mocks.saved.size).toBe(0);
  });

  it("indexes once enabled, and reports it ready", async () => {
    const { result } = renderHook(() => useMessageSearchIndex(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.index.search("hello").hits).toHaveLength(1);
  });

  it("changes version when a message arrives, so results can refresh", async () => {
    const { result } = renderHook(() => useMessageSearchIndex(true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const before = result.current.version;

    act(() => {
      for (const listener of mocks.saved) listener(message("m2", "new message"));
    });

    expect(result.current.version).toBeGreaterThan(before);
    expect(result.current.index.search("new").hits).toHaveLength(1);
  });

  it("empties the index when the screen using it goes away", async () => {
    const { result, unmount } = renderHook(() => useMessageSearchIndex(true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const { index } = result.current;

    unmount();

    expect(index.size).toBe(0);
    expect(mocks.saved.size).toBe(0);
  });
});
