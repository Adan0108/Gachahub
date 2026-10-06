import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationPreviews } from "../hooks/chat/useConversationPreviews";

const mocks = vi.hoisted(() => ({ get: vi.fn(), listener: null }));

vi.mock("../lib/mls/storage/messagePlaintextStore", () => ({
  EncryptedIndexedDbMessagePlaintextStore: class {
    get = mocks.get;
  },
  onMessageSaved: (listener) => {
    mocks.listener = listener;
    return () => {
      mocks.listener = null;
    };
  },
}));

const convo = (id, message) => ({ id, lastMessage: message });
const msg = (id, extra = {}) => ({ id, senderId: "peer", status: "SENT", ...extra });
const text = (body) => ({ envelope: { type: "text", body } });

describe("useConversationPreviews", () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(undefined);
    mocks.listener = null;
  });

  it("reads already-decrypted last messages from the local cache", async () => {
    mocks.get.mockImplementation(async (id) => (id === "m1" ? text("Ok :>") : undefined));
    const list = [convo("c1", msg("m1")), convo("c2", msg("m2"))];
    const { result } = renderHook(() => useConversationPreviews(list, "me"));

    await waitFor(() => expect(result.current).toEqual({ m1: "Ok :>" }));
  });

  it("prefixes your own messages", async () => {
    mocks.get.mockResolvedValue(text("hello"));
    const list = [convo("c1", msg("m1", { senderId: "me" }))];
    const { result } = renderHook(() => useConversationPreviews(list, "me"));

    await waitFor(() => expect(result.current).toEqual({ m1: "You: hello" }));
  });

  it("words an unsent message without reading the cache", async () => {
    const list = [convo("c1", msg("m1", { status: "DELETED" }))];
    const { result } = renderHook(() => useConversationPreviews(list, "me"));

    await waitFor(() => expect(result.current).toEqual({ m1: "Message unsent" }));
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("fills in a preview the moment a message is saved", async () => {
    const list = [convo("c1", msg("m1"))];
    const { result } = renderHook(() => useConversationPreviews(list, "me"));
    await waitFor(() => expect(mocks.listener).not.toBeNull());

    act(() => mocks.listener({ messageId: "m1", envelope: { type: "text", body: "fresh" } }));

    expect(result.current).toEqual({ m1: "fresh" });
  });

  it("ignores saves for messages that are not a conversation's last", async () => {
    const list = [convo("c1", msg("m1"))];
    const { result } = renderHook(() => useConversationPreviews(list, "me"));
    await waitFor(() => expect(mocks.listener).not.toBeNull());

    act(() => mocks.listener({ messageId: "other", envelope: { type: "text", body: "nope" } }));

    expect(result.current).toEqual({});
  });

  it("does not re-read a message it already has when the list refreshes", async () => {
    mocks.get.mockResolvedValue(text("Ok"));
    const { result, rerender } = renderHook(({ list }) => useConversationPreviews(list, "me"), {
      initialProps: { list: [convo("c1", msg("m1"))] },
    });
    await waitFor(() => expect(result.current).toEqual({ m1: "Ok" }));

    rerender({ list: [convo("c1", msg("m1"))] });

    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("tries again on a later refresh when a message was not cached yet", async () => {
    const { result, rerender } = renderHook(({ list }) => useConversationPreviews(list, "me"), {
      initialProps: { list: [convo("c1", msg("m1"))] },
    });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    mocks.get.mockResolvedValue(text("now here"));

    rerender({ list: [convo("c1", msg("m1"))] });

    await waitFor(() => expect(result.current).toEqual({ m1: "now here" }));
  });

  describe("edited messages", () => {
    const edit = (target, body) => ({
      messageId: `edit-of-${target}`,
      envelope: { v: 1, type: "edit", body: { targetMessageId: target, text: body, n: 1 } },
    });

    it("shows the new text the moment an edit of the last message is saved", async () => {
      mocks.get.mockResolvedValue(text("old text"));
      const list = [convo("c1", msg("m1"))];
      const { result } = renderHook(() => useConversationPreviews(list, "me"));
      await waitFor(() => expect(result.current).toEqual({ m1: "old text" }));

      act(() => mocks.listener(edit("m1", "new text")));

      expect(result.current).toEqual({ m1: "new text" });
    });

    it("prefixes an edit of your own message like the original", async () => {
      const list = [convo("c1", msg("m1", { senderId: "me" }))];
      const { result } = renderHook(() => useConversationPreviews(list, "me"));
      await waitFor(() => expect(mocks.listener).not.toBeNull());

      act(() => mocks.listener(edit("m1", "fixed")));

      expect(result.current).toEqual({ m1: "You: fixed" });
    });

    it("ignores an edit of a message that is not a conversation last", async () => {
      const list = [convo("c1", msg("m1"))];
      const { result } = renderHook(() => useConversationPreviews(list, "me"));
      await waitFor(() => expect(mocks.listener).not.toBeNull());

      act(() => mocks.listener(edit("older", "nope")));

      expect(result.current).toEqual({});
    });

    it("keeps the edited text when the original is only read afterwards", async () => {
      let finishRead;
      mocks.get.mockImplementation(() => new Promise((resolve) => (finishRead = resolve)));
      const list = [convo("c1", msg("m1"))];
      const { result } = renderHook(() => useConversationPreviews(list, "me"));
      await waitFor(() => expect(mocks.listener).not.toBeNull());

      act(() => mocks.listener(edit("m1", "edited first")));
      await act(async () => finishRead(text("original")));

      expect(result.current).toEqual({ m1: "edited first" });
    });
  });
});
