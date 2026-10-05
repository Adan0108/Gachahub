"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useUserSearch } from "../hooks/chat/useUserSearch";
import { initialOf } from "../lib/chat/chatDisplay";
import { activeMention, splitMentions } from "../lib/mentions";

/**
 * Text input that confirms `@handle` mentions: once a full, exact handle is typed, a dropdown shows
 * the real user; picking them fills in the canonical handle and colours it. The lookup is exact,
 * so a partial handle never suggests anyone.
 */
export function MentionInput({ value, onChange, onKeyDown, ...inputProps }) {
  const inputRef = useRef(null);
  const backdropRef = useRef(null);
  const pendingCaret = useRef(null);
  const { user: me } = useCurrentUser();
  const [caret, setCaret] = useState(0);
  const [confirmed, setConfirmed] = useState(() => new Set());
  const [dismissedStart, setDismissedStart] = useState(null);

  const active = activeMention(value, caret);
  const showPopup = Boolean(active) && dismissedStart !== active.start;
  const search = useUserSearch(showPopup ? `@${active.handle}` : "");
  const match = showPopup ? search.items[0] : undefined;
  const isMe = showPopup && active.handle.toLowerCase() === me?.username?.toLowerCase();
  const popupVisible = showPopup && !search.error;

  const parts = splitMentions(value, confirmed);
  const highlighted = parts.some((part) => part.mention);

  const pick = (picked) => {
    const handle = `@${picked.username} `;
    const position = active.start + handle.length;

    pendingCaret.current = position;
    setCaret(position);
    setConfirmed((previous) => new Set(previous).add(picked.username.toLowerCase()));
    onChange(value.slice(0, active.start) + handle + value.slice(active.end));
  };

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    if (pendingCaret.current !== null) {
      input.focus();
      input.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }

    const backdrop = backdropRef.current;
    if (!backdrop) return;

    const style = getComputedStyle(input);
    backdrop.style.fontFamily = style.fontFamily;
    backdrop.style.fontSize = style.fontSize;
    backdrop.style.fontWeight = style.fontWeight;
    backdrop.style.letterSpacing = style.letterSpacing;
    backdrop.style.padding = style.padding;
    backdrop.scrollLeft = input.scrollLeft;
  });

  const handleKeyDown = (event) => {
    if (popupVisible && !event.nativeEvent.isComposing) {
      if ((event.key === "Enter" || event.key === "Tab") && match) {
        event.preventDefault();
        pick(match);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedStart(active.start);
        return;
      }
    }
    onKeyDown?.(event);
  };

  return (
    <div className="mention-input">
      {highlighted && (
        <div aria-hidden="true" className="mention-input-backdrop" ref={backdropRef}>
          <span>
            {parts.map((part, index) =>
              part.mention ? (
                <span className="mention" key={index}>
                  {part.text}
                </span>
              ) : (
                part.text
              ),
            )}
          </span>
        </div>
      )}
      <input
        {...inputProps}
        className={highlighted ? "has-highlight" : undefined}
        onChange={(event) => {
          setCaret(event.target.selectionStart ?? event.target.value.length);
          onChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        onSelect={(event) => setCaret(event.target.selectionStart ?? 0)}
        ref={inputRef}
        value={value}
      />
      {popupVisible && (
        <div className="mention-popup">
          {match ? (
            <button
              className="mention-option"
              onClick={() => pick(match)}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <span className="chat-avatar small">{initialOf(match.name)}</span>
              <span>{match.name}</span>
              <span className="user-picker-handle">@{match.username}</span>
            </button>
          ) : (
            <span className="mention-popup-note" role="status">
              {isMe
                ? "That's you."
                : search.isLoading
                  ? `Looking up @${active.handle}...`
                  : `No one has the exact handle @${active.handle}.`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
