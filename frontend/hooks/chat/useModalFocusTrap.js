"use client";

import { useEffect, useRef } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Escape-to-close and Tab focus-trapping for a modal, plus returning focus to
 * whatever opened it once it closes. Pulled out of the profile/studio pages'
 * near-identical copies of this same effect into one shared hook.
 *
 * `modalRef` goes on the modal container; `triggerRef` is optional and, if
 * given, gets refocused when `isOpen` goes back to false.
 */
export function useModalFocusTrap(isOpen, onClose, triggerRef) {
  const modalRef = useRef(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableItems = Array.from(
        modalRef.current?.querySelectorAll(focusableSelector) || [],
      ).filter((element) => element.offsetParent !== null);
      const firstItem = focusableItems[0];
      const lastItem = focusableItems.at(-1);

      if (!firstItem || !lastItem) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return;
    }

    if (wasOpenRef.current) {
      triggerRef?.current?.focus();
      wasOpenRef.current = false;
    }
  }, [isOpen, triggerRef]);

  return modalRef;
}
