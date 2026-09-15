"use client";

import { useEffect, useRef } from "react";

export function useDismiss({ isOpen, onDismiss, contentRef, triggerRef, restoreFocus = true }) {
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    wasOpenRef.current = true;

    const dismiss = (event) => {
      const isEscape = event.type === "keydown" && event.key === "Escape";
      const isOutsideClick =
        event.type === "mousedown" &&
        !contentRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target);

      if (isEscape || isOutsideClick) onDismiss();
    };

    window.addEventListener("keydown", dismiss);
    window.addEventListener("mousedown", dismiss);
    return () => {
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("mousedown", dismiss);
    };
  }, [contentRef, isOpen, onDismiss, triggerRef]);

  useEffect(() => {
    if (!isOpen && wasOpenRef.current) {
      if (restoreFocus) triggerRef.current?.focus();
      wasOpenRef.current = false;
    }
  }, [isOpen, restoreFocus, triggerRef]);
}
