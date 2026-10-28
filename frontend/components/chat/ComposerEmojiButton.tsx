"use client";

import { useRef, useState } from "react";
import { FiSmile } from "react-icons/fi";
import { EmojiPicker } from "./EmojiPicker";
import type { ReactionChoice } from "../../lib/chat/chatReactions";
import { floatingPortal, floatingStyle, useFloatingPosition } from "../../hooks/chat/useFloatingPosition";
import { useMenuDismiss } from "../../hooks/chat/useMenuDismiss";

/** A smiley beside the message box that opens the emoji and custom emote picker; `onPick` gets { kind: "emoji", emoji } or { kind: "emote", emote }. */
export function ComposerEmojiButton({
  onPick,
  disabled = false,
}: {
  onPick: (choice: ReactionChoice) => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  useMenuDismiss(isOpen, () => setIsOpen(false), buttonRef, menuRef);
  const style = useFloatingPosition(isOpen, buttonRef, menuRef, { align: "end" });

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-label="Add an emoji or emote"
        className="chat-attach-button"
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        ref={buttonRef}
        type="button"
      >
        <FiSmile />
      </button>
      {isOpen &&
        floatingPortal(
          <div className="message-actions-picker" ref={menuRef} style={floatingStyle(style)}>
            <EmojiPicker
              onPick={(choice: ReactionChoice, keepOpen: boolean) => {
                onPick(choice);
                if (!keepOpen) setIsOpen(false);
              }}
            />
          </div>,
        )}
    </>
  );
}
