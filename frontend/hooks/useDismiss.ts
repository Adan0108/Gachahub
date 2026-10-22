"use client";

import { useEffect, useRef, type RefObject } from "react";

type DismissOptions = {
  isOpen: boolean;
  onDismiss: () => void;
  contentRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
};

export function useDismiss({
  isOpen,
  onDismiss,
  contentRef,
  triggerRef,
  restoreFocus = true,
}: DismissOptions) {
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    wasOpenRef.current = true;

    const dismiss = (event: KeyboardEvent | MouseEvent) => {
      const isEscape = event instanceof KeyboardEvent && event.key === "Escape";
      const isOutsideClick =
        event instanceof MouseEvent &&
        !contentRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node);

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
