import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFloatingPosition } from "../hooks/chat/useFloatingPosition";

const rect = ({ left, top, width, height }) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

function elementWithRect(box) {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => rect(box);
  return { current: element };
}

describe("useFloatingPosition", () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;

  beforeEach(() => {
    window.innerWidth = 1000;
    window.innerHeight = 800;
  });
  afterEach(() => {
    window.innerWidth = originalWidth;
    window.innerHeight = originalHeight;
  });

  const place = (options, button = { left: 400, top: 100, width: 30, height: 30 }, menu = { left: 0, top: 0, width: 200, height: 40 }) => {
    // Made once: a new ref on every render would make the hook place itself again, forever.
    const buttonRef = elementWithRect(button);
    const menuRef = elementWithRect(menu);
    return renderHook(() => useFloatingPosition(true, buttonRef, menuRef, options)).result.current;
  };

  it("lines the menu up with the button's left edge by default, just below it", () => {
    expect(place()).toEqual({ position: "fixed", top: 136, left: 400 });
  });

  it("lines the menu up with the button's right edge for end", () => {
    expect(place({ align: "end" }).left).toBe(430 - 200);
  });

  it("puts the middle of the menu on the middle of the button for center", () => {
    const { left } = place({ align: "center" });

    expect(left + 200 / 2).toBe(400 + 30 / 2);
  });

  it("keeps a centred menu on screen near the left edge", () => {
    expect(place({ align: "center" }, { left: 10, top: 100, width: 30, height: 30 }).left).toBe(8);
  });

  it("keeps a centred menu on screen near the right edge", () => {
    expect(place({ align: "center" }, { left: 960, top: 100, width: 30, height: 30 }).left).toBe(1000 - 200 - 8);
  });

  it("opens above the button when there is no room below", () => {
    const { top } = place({ align: "center" }, { left: 400, top: 760, width: 30, height: 30 });

    expect(top).toBe(760 - 6 - 40);
  });

  it("has no position while closed", () => {
    const buttonRef = elementWithRect({ left: 0, top: 0, width: 1, height: 1 });
    const menuRef = elementWithRect({ left: 0, top: 0, width: 1, height: 1 });
    const { result } = renderHook(() => useFloatingPosition(false, buttonRef, menuRef));

    expect(result.current).toBeNull();
  });
});
