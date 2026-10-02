"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** Closes an open dropdown on Escape or a click outside its button+panel. */
export function useMenuDismiss(
  isOpen: boolean,
  onClose: () => void,
  buttonRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
) {
  // Read through a ref so an inline onClose (a new function every render) doesn't tear down and
  // re-add both window listeners on every render the open menu sits through.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    const handle = (event: KeyboardEvent | MouseEvent) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (
        event.type === "mousedown" &&
        !menuRef.current?.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      ) {
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handle);
    window.addEventListener("mousedown", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      window.removeEventListener("mousedown", handle);
    };
  }, [isOpen, buttonRef, menuRef]);
}
