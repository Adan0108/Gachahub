"use client";

import { useRef, useState } from "react";
import { FiCopy, FiCornerUpLeft, FiEdit2, FiMoreHorizontal, FiPlus, FiSmile, FiTrash2 } from "react-icons/fi";
import { Emoji } from "./Emoji";
import { EmojiPicker } from "./EmojiPicker";
import { floatingPortal, floatingStyle, useFloatingPosition } from "../../hooks/chat/useFloatingPosition";
import { useMenuDismiss } from "../../hooks/chat/useMenuDismiss";
import type { ReactionChoice } from "../../lib/chat/chatReactions";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/** Hover toolbar on a message: react, reply, and a "..." menu (copy, edit your own, remove). */
export function MessageActions({
  canCopy,
  canEdit = false,
  canRemove = true,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onRemove,
}: {
  canCopy: boolean;
  canEdit?: boolean;
  canRemove?: boolean;
  onReact: (choice: ReactionChoice) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [isReactOpen, setIsReactOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isFullPickerOpen, setIsFullPickerOpen] = useState(false);
  const reactButtonRef = useRef<HTMLButtonElement>(null);
  const reactMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const closeReact = () => {
    setIsReactOpen(false);
    setIsFullPickerOpen(false);
  };
  useMenuDismiss(isReactOpen, closeReact, reactButtonRef, reactMenuRef);
  useMenuDismiss(isMoreOpen, () => setIsMoreOpen(false), moreButtonRef, moreMenuRef);
  // The quick row and the full picker are different sizes, so each gets its own placement against the same menu element.
  const quickStyle = useFloatingPosition(isReactOpen && !isFullPickerOpen, reactButtonRef, reactMenuRef, {
    align: "center",
  });
  const fullStyle = useFloatingPosition(isReactOpen && isFullPickerOpen, reactButtonRef, reactMenuRef, {
    align: "center",
  });
  const reactStyle = isFullPickerOpen ? fullStyle : quickStyle;

  const pick = (choice: ReactionChoice) => {
    onReact(choice);
    closeReact();
  };
  const moreStyle = useFloatingPosition(isMoreOpen, moreButtonRef, moreMenuRef, { align: "end" });

  return (
    <div className={`message-actions ${isReactOpen || isMoreOpen ? "open" : ""}`}>
      <div className="message-actions-menu-wrap">
        <button
          aria-label="React"
          onClick={() => (isReactOpen ? closeReact() : setIsReactOpen(true))}
          ref={reactButtonRef}
          type="button"
        >
          <FiSmile />
        </button>
        {isReactOpen &&
          floatingPortal(
            <div
              className="message-actions-picker"
              ref={reactMenuRef}
              role="menu"
              style={floatingStyle(reactStyle)}
            >
              {isFullPickerOpen ? (
                <EmojiPicker onPick={pick} />
              ) : (
                <div className="message-actions-picker-row">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button key={emoji} onClick={() => pick({ kind: "emoji", emoji })} role="menuitem" type="button">
                      <Emoji emoji={emoji} />
                    </button>
                  ))}
                  <button
                    aria-label="More reactions"
                    onClick={() => setIsFullPickerOpen(true)}
                    role="menuitem"
                    type="button"
                  >
                    <FiPlus />
                  </button>
                </div>
              )}
            </div>,
          )}
      </div>
      <button aria-label="Reply" onClick={onReply} type="button">
        <FiCornerUpLeft />
      </button>
      <div className="message-actions-menu-wrap">
        <button
          aria-label="More"
          onClick={() => setIsMoreOpen((current) => !current)}
          ref={moreButtonRef}
          type="button"
        >
          <FiMoreHorizontal />
        </button>
        {isMoreOpen &&
          floatingPortal(
            <div
              className="chat-menu message-actions-more"
              ref={moreMenuRef}
              role="menu"
              style={floatingStyle(moreStyle)}
            >
              {canCopy && (
                <button
                  onClick={() => {
                    onCopy();
                    setIsMoreOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FiCopy /> Copy
                </button>
              )}
              {canEdit && (
                <button
                  onClick={() => {
                    onEdit();
                    setIsMoreOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FiEdit2 /> Edit
                </button>
              )}
              {canRemove && (
                <button
                  onClick={() => {
                    onRemove();
                    setIsMoreOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FiTrash2 /> Remove
                </button>
              )}
            </div>,
          )}
      </div>
    </div>
  );
}
