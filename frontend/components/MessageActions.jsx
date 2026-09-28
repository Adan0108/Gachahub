"use client";

import { useRef, useState } from "react";
import { FiCopy, FiCornerUpLeft, FiEyeOff, FiMoreHorizontal, FiSmile, FiTrash2 } from "react-icons/fi";
import { useMenuDismiss } from "../hooks/useMenuDismiss";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/** Hover toolbar on a message: react, reply, and a "..." menu (copy, unsend for your own messages). */
export function MessageActions({
  isMine,
  canCopy,
  onReact,
  onReply,
  onCopy,
  onDelete,
  onDeleteForMe,
}) {
  const [isReactOpen, setIsReactOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const reactButtonRef = useRef(null);
  const reactMenuRef = useRef(null);
  const moreButtonRef = useRef(null);
  const moreMenuRef = useRef(null);
  useMenuDismiss(isReactOpen, () => setIsReactOpen(false), reactButtonRef, reactMenuRef);
  useMenuDismiss(isMoreOpen, () => setIsMoreOpen(false), moreButtonRef, moreMenuRef);

  return (
    <div className={`message-actions ${isReactOpen || isMoreOpen ? "open" : ""}`}>
      <div className="message-actions-menu-wrap">
        <button
          aria-label="React"
          onClick={() => setIsReactOpen((current) => !current)}
          ref={reactButtonRef}
          type="button"
        >
          <FiSmile />
        </button>
        {isReactOpen && (
          <div className="message-actions-picker" ref={reactMenuRef} role="menu">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onReact(emoji);
                  setIsReactOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                {emoji}
              </button>
            ))}
          </div>
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
        {isMoreOpen && (
          <div className="chat-menu message-actions-more" ref={moreMenuRef} role="menu">
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
            <button
              onClick={() => {
                onDeleteForMe();
                setIsMoreOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <FiEyeOff /> Delete for me
            </button>
            {isMine && (
              <button
                onClick={() => {
                  onDelete();
                  setIsMoreOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <FiTrash2 /> Unsend
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
