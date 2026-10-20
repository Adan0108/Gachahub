"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { typingMention } from "../lib/mentions";

/**
 * The @ being typed in a composer: what to search for, and picking a member from the list.
 * `query` is undefined while no @ is being typed or its list was closed with Escape.
 */
export function useMentionPicker(draft, setDraft, inputRef) {
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  // Where the @ being typed started, once the person closed its list with Escape
  const [dismissedAt, setDismissedAt] = useState(null);
  const pendingCaret = useRef(null);
  const typing = typingMention(draft, caret);
  const query = typing && dismissedAt !== typing.start ? typing.query : undefined;

  // After picking, the caret goes back behind the inserted handle
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const pick = (member) => {
    const inserted = `@${member.username} `;
    const position = typing.start + inserted.length;
    setDraft(`${draft.slice(0, typing.start)}${inserted}${draft.slice(typing.end)}`);
    setCaret(position);
    pendingCaret.current = position;
    setHighlighted(0);
    inputRef.current?.focus();
  };

  /** Arrows, Enter, Tab and Escape while the list shows `items`; returns true when it used the key. */
  const handleKey = (event, items) => {
    if (query === undefined || items.length === 0 || event.nativeEvent.isComposing) return false;
    const count = items.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      setHighlighted((current) => (current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter" || event.key === "Tab") {
      pick(items[Math.min(highlighted, count - 1)]);
    } else if (event.key === "Escape") {
      setDismissedAt(typing.start);
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  };

  return {
    query,
    highlighted,
    setHighlighted,
    pick,
    handleKey,
    onInput: (event) => {
      setCaret(event.target.selectionStart ?? event.target.value.length);
      setHighlighted(0);
    },
    onSelect: (event) => setCaret(event.target.selectionStart ?? 0),
  };
}
