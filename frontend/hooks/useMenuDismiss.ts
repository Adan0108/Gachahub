"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

/** Closes an open dropdown on Escape or a click outside its button+panel. */
export function useMenuDismiss(
  isOpen: boolean,
  onClose: () => void,
  buttonRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handle = (event: KeyboardEvent | MouseEvent) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key === "Escape") {
        onClose();
        return;
      }
      if (
        event.type === "mousedown" &&
        !menuRef.current?.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", handle);
    window.addEventListener("mousedown", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      window.removeEventListener("mousedown", handle);
    };
  }, [isOpen, onClose, buttonRef, menuRef]);
}
