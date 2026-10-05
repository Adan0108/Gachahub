import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStickToBottom } from "../hooks/chat/useStickToBottom";

function setup({ withScrollTo = true } = {}) {
  const list = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
  if (withScrollTo) list.scrollTo = vi.fn();
  const view = renderHook(() => useStickToBottom({ current: list }));
  const scrollTo = (distanceFromBottom) => {
    list.scrollTop = list.scrollHeight - list.clientHeight - distanceFromBottom;
    act(() => view.result.current.onScroll({ currentTarget: list }));
  };
  return { list, view, scrollTo };
}

describe("useStickToBottom", () => {
  it("goes to the true end of the list, past its bottom padding", () => {
    const { list, view } = setup();
    list.scrollTop = 0;

    view.result.current.scrollToBottom();

    expect(list.scrollTop).toBe(list.scrollHeight);
  });

  it("can glide there instead of jumping", () => {
    const { list, view } = setup();

    view.result.current.scrollToBottom("smooth");

    expect(list.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
  });

  it("still gets there where smooth scrolling is unavailable", () => {
    const { list, view } = setup({ withScrollTo: false });
    list.scrollTop = 0;

    view.result.current.scrollToBottom("smooth");

    expect(list.scrollTop).toBe(1000);
  });

  it("follows new content while you are at the bottom", () => {
    const { list, view } = setup();
    list.scrollTop = 0;

    view.result.current.followIfNearBottom();

    expect(list.scrollTop).toBe(1000);
  });

  it("does not follow once you have scrolled up to read", () => {
    const { list, view, scrollTo } = setup();
    scrollTo(500);
    const before = list.scrollTop;

    view.result.current.followIfNearBottom();

    expect(list.scrollTop).toBe(before);
  });

  it("follows again after you scroll back down", () => {
    const { list, view, scrollTo } = setup();
    scrollTo(500);
    scrollTo(0);
    list.scrollTop = 0;

    view.result.current.followIfNearBottom();

    expect(list.scrollTop).toBe(1000);
  });

  it("shows the jump button only while you are away from the bottom", () => {
    const { view, scrollTo } = setup();
    expect(view.result.current.showJumpToBottom).toBe(false);

    scrollTo(500);
    expect(view.result.current.showJumpToBottom).toBe(true);

    scrollTo(30);
    expect(view.result.current.showJumpToBottom).toBe(false);
  });

  it("a jump to the bottom makes it follow again", () => {
    const { list, view, scrollTo } = setup();
    scrollTo(500);

    view.result.current.scrollToBottom();
    list.scrollTop = 0;
    view.result.current.followIfNearBottom();

    expect(list.scrollTop).toBe(1000);
  });
});
