// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newLineElementId } from "../../lib/chat/unreadMarker";
import { useOpenAtLine } from "./useOpenAtLine";

type Props = Parameters<typeof useOpenAtLine>[0];

describe("useOpenAtLine", () => {
  let line: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    line = document.createElement("div");
    line.id = newLineElementId("m2");
    document.body.appendChild(line);
  });
  afterEach(() => {
    line.remove();
    vi.useRealTimers();
  });

  const setup = () => {
    const revealAtTop = vi.fn();
    const base: Props = { conversationId: "c1", lineId: "m2", rendered: 1, revealAtTop, gapPx: 40 };
    const hook = renderHook((props: Props) => useOpenAtLine(props), { initialProps: base });
    return { ...hook, base, revealAtTop };
  };

  it("brings the line into view once per opening, leaving room for the bar", () => {
    const { rerender, base, revealAtTop } = setup();
    vi.runAllTimers();
    rerender({ ...base, rendered: 2 });
    vi.runAllTimers();

    expect(revealAtTop).toHaveBeenCalledTimes(1);
    expect(revealAtTop).toHaveBeenCalledWith(line, { gapPx: 40, onlyIfAbove: true });
  });

  it("does it again after you leave the chat and come back to the same line", () => {
    const { rerender, base, revealAtTop } = setup();
    vi.runAllTimers();
    rerender({ ...base, conversationId: "c2", lineId: undefined });
    rerender(base);
    vi.runAllTimers();

    expect(revealAtTop).toHaveBeenCalledTimes(2);
  });

  it("does not scroll a chat you already left in the same frame", () => {
    const { rerender, base, revealAtTop } = setup();
    rerender({ ...base, conversationId: "c2", lineId: undefined });
    vi.runAllTimers();

    expect(revealAtTop).not.toHaveBeenCalled();
  });
});
