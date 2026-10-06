"use client";

import { useEffect, useRef, useState } from "react";
import { FiCopy, FiCornerUpLeft, FiEdit2, FiMoreHorizontal, FiPlus, FiSmile, FiTrash2 } from "react-icons/fi";
import { floatingPortal, floatingStyle, useFloatingPosition } from "../../hooks/chat/useFloatingPosition";
import { useMenuDismiss } from "../../hooks/chat/useMenuDismiss";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const COMING_SOON_MS = 1800;

/** Hover toolbar on a message: react, reply, and a "..." menu (copy, edit your own, remove). */
export function MessageActions({
  canCopy,
  canEdit = false,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onRemove,
}) {
  const [isReactOpen, setIsReactOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isComingSoonShown, setIsComingSoonShown] = useState(false);
  const comingSoonTimerRef = useRef(null);
  const reactButtonRef = useRef(null);
  const reactMenuRef = useRef(null);
  const moreButtonRef = useRef(null);
  const moreMenuRef = useRef(null);
  useMenuDismiss(isReactOpen, () => setIsReactOpen(false), reactButtonRef, reactMenuRef);
  useMenuDismiss(isMoreOpen, () => setIsMoreOpen(false), moreButtonRef, moreMenuRef);
  const reactStyle = useFloatingPosition(isReactOpen, reactButtonRef, reactMenuRef, { align: "center" });

  useEffect(() => () => window.clearTimeout(comingSoonTimerRef.current), []);

  const showComingSoon = () => {
    window.clearTimeout(comingSoonTimerRef.current);
    setIsComingSoonShown(true);
    comingSoonTimerRef.current = window.setTimeout(() => setIsComingSoonShown(false), COMING_SOON_MS);
  };
  const moreStyle = useFloatingPosition(isMoreOpen, moreButtonRef, moreMenuRef, { align: "end" });

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
        {isReactOpen &&
          floatingPortal(
            <div
              className="message-actions-picker"
              ref={reactMenuRef}
              role="menu"
              style={floatingStyle(reactStyle)}
            >
              <div className="message-actions-picker-row">
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
                <button aria-label="More reactions" onClick={showComingSoon} role="menuitem" type="button">
                  <FiPlus />
                </button>
              </div>
              {isComingSoonShown && (
                <small className="message-actions-picker-note" role="status">
                  More reactions are coming soon.
                </small>
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
            </div>,
          )}
      </div>
    </div>
  );
}
