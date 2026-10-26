// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatEscape } from "./useChatEscape";

const press = (handledFirst = false) => {
  if (handledFirst) {
    const claim = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", claim, { once: true });
  }
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  vi.runAllTimers();
};

describe("useChatEscape", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (atBottom: boolean) => {
    const scrollToBottom = vi.fn();
    const markAllRead = vi.fn();
    renderHook(() => useChatEscape({ enabled: true, atBottom, scrollToBottom, markAllRead }));
    return { scrollToBottom, markAllRead };
  };

  it("scrolled up, takes you to the bottom without marking anything read", () => {
    const { scrollToBottom, markAllRead } = setup(false);
    press();
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(markAllRead).not.toHaveBeenCalled();
  });

  it("at the bottom, marks the chat read", () => {
    const { markAllRead } = setup(true);
    press();
    expect(markAllRead).toHaveBeenCalledTimes(1);
  });

  // A menu that closes on Escape, added after the chat's listener, still claims the press
  it("leaves a press alone that a menu or dialog already handled", () => {
    const { scrollToBottom, markAllRead } = setup(true);
    press(true);
    expect(markAllRead).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });
});
