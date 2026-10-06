import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageEdit } from "../hooks/chat/useMessageEdit";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function setup({ edited = new Map(), createdAt = minutesAgo(2), send, startingDraft = "half typed" } = {}) {
  const props = {
    send: send ?? vi.fn().mockResolvedValue({ message: { id: "edit-1" } }),
    onSent: vi.fn(),
    focusInput: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(
    () => {
      const [draft, setDraft] = useState(startingDraft);
      const edit = useMessageEdit({
        draft,
        setDraft,
        edited,
        messagesById: new Map([
          ["m1", { id: "m1", createdAt }],
          ["m2", { id: "m2", createdAt }],
        ]),
        ...props,
      });
      return { draft, setDraft, edit };
    },
    { wrapper },
  );
  return { ...props, view };
}

const startEditing = (view, text = "hello", id = "m1") => act(() => view.result.current.edit.start({ id, text }));
const typeDraft = (view, text) => act(() => view.result.current.setDraft(text));
const submit = (view) => act(() => view.result.current.edit.submit());
/** A send that stays unanswered until the test settles it. */
function controlledSend() {
  const calls = [];
  const send = vi.fn(
    (variables) =>
      new Promise((resolve, reject) => {
        calls.push({ variables, resolve, reject });
      }),
  );
  return { send, calls };
}

describe("useMessageEdit", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("is not editing until a message is picked", () => {
    const { view } = setup();

    expect(view.result.current.edit.target).toBeNull();
    expect(view.result.current.draft).toBe("half typed");
    expect(view.result.current.edit.pending.size).toBe(0);
  });

  it("puts the message text in the composer and focuses it", () => {
    const { view, focusInput } = setup();

    startEditing(view);

    expect(view.result.current.edit.target).toMatchObject({ id: "m1" });
    expect(view.result.current.draft).toBe("hello");
    expect(focusInput).toHaveBeenCalled();
  });

  it("gives back what you had typed when you cancel", () => {
    const { view } = setup();
    startEditing(view);

    act(() => view.result.current.edit.leave());

    expect(view.result.current.edit.target).toBeNull();
    expect(view.result.current.draft).toBe("half typed");
  });

  it("still gives back the original draft after switching to another message", () => {
    const { view } = setup();
    startEditing(view, "first");
    startEditing(view, "second");

    act(() => view.result.current.edit.leave());

    expect(view.result.current.draft).toBe("half typed");
  });

  it("just leaves edit mode when nothing changed or the text is blank", () => {
    const { view, send } = setup();
    startEditing(view);

    submit(view);
    expect(send).not.toHaveBeenCalled();
    expect(view.result.current.edit.target).toBeNull();
    expect(view.result.current.edit.pending.size).toBe(0);

    startEditing(view);
    typeDraft(view, "   ");
    submit(view);
    expect(send).not.toHaveBeenCalled();
    expect(view.result.current.edit.target).toBeNull();
  });

  describe("saving", () => {
    it("frees the composer at once and shows the edit as pending while the server answers", () => {
      const { send } = controlledSend();
      const { view } = setup({ send });
      startEditing(view);
      typeDraft(view, "  hello there  ");

      submit(view);

      expect(view.result.current.edit.target).toBeNull();
      expect(view.result.current.draft).toBe("half typed");
      expect(view.result.current.edit.pending.get("m1")).toMatchObject({ text: "hello there", n: 1, failed: false });
    });

    it("sends the edit with a fresh id, as the first edit of an unedited message", async () => {
      const { send, calls } = controlledSend();
      const { view } = setup({ send });
      startEditing(view);
      typeDraft(view, "hello there");

      submit(view);

      await waitFor(() => expect(send).toHaveBeenCalled());
      expect(calls[0].variables).toEqual({ messageId: "m1", text: "hello there", n: 1, clientId: expect.any(String) });
    });

    it("numbers the next edit after the ones already made", async () => {
      const edited = new Map([["m1", { versions: [{ text: "a" }, { text: "b" }, { text: "c" }] }]]);
      const { send, calls } = controlledSend();
      const { view } = setup({ edited, send });
      startEditing(view, "c");
      typeDraft(view, "d");

      submit(view);

      await waitFor(() => expect(send).toHaveBeenCalled());
      expect(calls[0].variables.n).toBe(3);
    });

    it("clears the pending edit and reports the stored message once the server has it", async () => {
      const { send, calls } = controlledSend();
      const { view, onSent } = setup({ send });
      startEditing(view);
      typeDraft(view, "hello there");
      submit(view);
      await waitFor(() => expect(calls).toHaveLength(1));

      await act(async () => calls[0].resolve({ message: { id: "edit-1" } }));

      expect(onSent).toHaveBeenCalledWith({ message: { id: "edit-1" } });
      await waitFor(() => expect(view.result.current.edit.pending.size).toBe(0));
    });

    it("keeps typing possible while an edit is still being saved", async () => {
      const { send, calls } = controlledSend();
      const { view } = setup({ send });
      startEditing(view);
      typeDraft(view, "hello there");
      submit(view);
      await waitFor(() => expect(calls).toHaveLength(1));

      typeDraft(view, "next message");

      expect(view.result.current.draft).toBe("next message");
      expect(view.result.current.edit.pending.has("m1")).toBe(true);
    });

    it("can have edits of different messages saving at the same time", async () => {
      const { send, calls } = controlledSend();
      const { view } = setup({ send });
      startEditing(view, "one", "m1");
      typeDraft(view, "one!");
      submit(view);
      startEditing(view, "two", "m2");
      typeDraft(view, "two!");
      submit(view);
      await waitFor(() => expect(calls).toHaveLength(2));

      expect([...view.result.current.edit.pending.keys()]).toEqual(["m1", "m2"]);

      await act(async () => calls[0].resolve({ message: { id: "e1" } }));

      await waitFor(() => expect([...view.result.current.edit.pending.keys()]).toEqual(["m2"]));
    });
  });

  describe("when saving fails", () => {
    async function failedEdit() {
      const { send, calls } = controlledSend();
      const setupResult = setup({ send });
      const { view } = setupResult;
      startEditing(view);
      typeDraft(view, "changed");
      submit(view);
      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => calls[0].reject(new Error("Messages can only be edited for 15 minutes")));
      return { ...setupResult, calls };
    }

    it("keeps the edit on the message, marked failed with the reason", async () => {
      const { view } = await failedEdit();

      expect(view.result.current.edit.pending.get("m1")).toMatchObject({
        text: "changed",
        failed: true,
        error: "Messages can only be edited for 15 minutes",
      });
      expect(view.result.current.edit.target).toBeNull();
    });

    it("retries with the same id, so the server never applies it twice", async () => {
      const { view, calls } = await failedEdit();
      const firstId = calls[0].variables.clientId;

      act(() => view.result.current.edit.retry("m1"));

      expect(view.result.current.edit.pending.get("m1")).toMatchObject({ failed: false });
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].variables).toEqual({ messageId: "m1", text: "changed", n: 1, clientId: firstId });

      await act(async () => calls[1].resolve({ message: { id: "edit-1" } }));
      await waitFor(() => expect(view.result.current.edit.pending.size).toBe(0));
    });

    it("lets you discard it, so the message goes back to what it said", async () => {
      const { view } = await failedEdit();

      act(() => view.result.current.edit.discard("m1"));

      expect(view.result.current.edit.pending.size).toBe(0);
    });

    it("does nothing when retrying an edit that is not there", () => {
      const { send } = controlledSend();
      const { view } = setup({ send });

      act(() => view.result.current.edit.retry("m1"));

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("refuses before sending", () => {
    it("text that is too long", () => {
      const { view, send } = setup();
      startEditing(view);
      typeDraft(view, "x".repeat(4001));

      submit(view);

      expect(send).not.toHaveBeenCalled();
      expect(view.result.current.edit.error).toBe("Edits can be up to 4000 characters.");
      expect(view.result.current.edit.target).not.toBeNull();
      expect(view.result.current.edit.pending.size).toBe(0);
    });

    it("an edit after the 15 minute window", () => {
      const { view, send } = setup({ createdAt: minutesAgo(16) });
      startEditing(view);
      typeDraft(view, "changed");

      submit(view);

      expect(send).not.toHaveBeenCalled();
      expect(view.result.current.edit.error).toBe("This message can't be edited any more.");
    });

    it("an eleventh edit", () => {
      const versions = Array.from({ length: 11 }, (_, i) => ({ text: `v${i}` }));
      const { view, send } = setup({ edited: new Map([["m1", { versions }]]) });
      startEditing(view, "v10");
      typeDraft(view, "changed");

      submit(view);

      expect(send).not.toHaveBeenCalled();
      expect(view.result.current.edit.error).toBe("This message can't be edited any more.");
    });
  });

  it("clears an old error when starting over", () => {
    const { view } = setup({ createdAt: minutesAgo(16) });
    startEditing(view);
    typeDraft(view, "changed");
    submit(view);
    expect(view.result.current.edit.error).not.toBe("");

    startEditing(view, "again");

    expect(view.result.current.edit.error).toBe("");
  });
});
