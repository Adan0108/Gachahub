"use client";

import { useLayoutEffect, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

export interface FloatingPositionOptions {
  /** Which edge of the button the menu's own edge lines up with. */
  align?: "start" | "end";
  /** Gap between the button and the menu. */
  gap?: number;
}

export interface FloatingStyle {
  position: "fixed";
  top: number;
  left: number;
}

/** A floating popover's style prop: the computed position, or hidden (not display:none, so it can still be measured) until placed. */
export function floatingStyle(style: FloatingStyle | null): CSSProperties {
  return style ?? { position: "fixed", visibility: "hidden", top: 0, left: 0 };
}

/**
 * Renders a floating popover into `document.body` instead of wherever it sits in the component
 * tree. `position: fixed` coordinates are only viewport-relative when nothing between the element
 * and the viewport has a transform/filter/perspective - any such ancestor becomes the containing
 * block instead, silently moving the popover. Portaling to body sidesteps that regardless of what
 * ancestors do, today or later.
 */
export function floatingPortal(node: ReactNode): ReactNode {
  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}

/**
 * Fixed-viewport coordinates for a popover anchored to a button, flipped above/clamped sideways
 * so it stays on screen. `position:fixed` measured from the button's own rect sidesteps every
 * ancestor's overflow/clipping and stacking quirks entirely - no `overflow:visible` patch needed.
 */
export function useFloatingPosition(
  isOpen: boolean,
  buttonRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  { align = "start", gap = 6 }: FloatingPositionOptions = {},
): FloatingStyle | null {
  const [style, setStyle] = useState<FloatingStyle | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setStyle(null);
      return undefined;
    }

    const place = () => {
      const button = buttonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;

      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const fitsBelow = buttonRect.bottom + gap + menuRect.height <= viewportHeight;
      const top = fitsBelow
        ? buttonRect.bottom + gap
        : Math.max(8, buttonRect.top - gap - menuRect.height);

      const preferredLeft = align === "end" ? buttonRect.right - menuRect.width : buttonRect.left;
      const left = Math.min(Math.max(8, preferredLeft), viewportWidth - menuRect.width - 8);

      setStyle({ position: "fixed", top, left });
    };

    place();
    // capture: true also catches the thread's own inner scroll container, not just the window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [isOpen, buttonRef, menuRef, align, gap]);

  return style;
}
