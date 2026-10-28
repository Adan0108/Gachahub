import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConversationDrafts } from "../hooks/chat/useConversationDrafts";

const setup = (initialId = "a") =>
  renderHook(({ id }) => useConversationDrafts(id), { initialProps: { id: initialId } });

describe("useConversationDrafts", () => {
  it("starts with an empty box", () => {
    expect(setup().result.current.draft).toBe("");
  });

  it("keeps what was typed in one conversation out of another", () => {
    const view = setup("a");
    act(() => view.result.current.setDraft("hello A"));

    view.rerender({ id: "b" });

    expect(view.result.current.draft).toBe("");
  });

  it("brings the draft back when you return to the conversation", () => {
    const view = setup("a");
    act(() => view.result.current.setDraft("hello A"));
    view.rerender({ id: "b" });
    act(() => view.result.current.setDraft("hello B"));

    view.rerender({ id: "a" });
    expect(view.result.current.draft).toBe("hello A");
    view.rerender({ id: "b" });
    expect(view.result.current.draft).toBe("hello B");
  });

  it("clears only the open conversation when it is emptied", () => {
    const view = setup("a");
    act(() => view.result.current.setDraft("hello A"));
    view.rerender({ id: "b" });
    act(() => view.result.current.setDraft("hello B"));

    act(() => view.result.current.setDraft(""));
    expect(view.result.current.draft).toBe("");
    view.rerender({ id: "a" });
    expect(view.result.current.draft).toBe("hello A");
  });

  it("can set the draft of a conversation that is not open", () => {
    const view = setup("a");
    view.rerender({ id: "b" });

    act(() => view.result.current.setDraftFor("a", "restored"));
    expect(view.result.current.draft).toBe("");

    view.rerender({ id: "a" });
    expect(view.result.current.draft).toBe("restored");
  });
});
