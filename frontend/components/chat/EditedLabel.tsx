"use client";

import { useRef, useState } from "react";
import {
  floatingPortal,
  floatingStyle,
  useFloatingPosition,
} from "../../hooks/chat/useFloatingPosition";
import { useMenuDismiss } from "../../hooks/chat/useMenuDismiss";
import { messageFullTimestamp } from "../../lib/chat/chatThread";
import type { MessageVersion } from "../../lib/chat/messageEdits";

/** "Edited" under a message; click it to see every version of the text. */
export function EditedLabel({ versions }: { versions: MessageVersion[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useMenuDismiss(isOpen, () => setIsOpen(false), buttonRef, menuRef);
  const style = useFloatingPosition(isOpen, buttonRef, menuRef);
  const newestFirst = [...versions].reverse();

  return (
    <>
      <button
        aria-expanded={isOpen}
        className="chat-message-edited"
        onClick={() => setIsOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        Edited
      </button>
      {isOpen &&
        floatingPortal(
          <div
            aria-label="Edit history"
            className="chat-menu chat-edit-history"
            ref={menuRef}
            role="dialog"
            style={floatingStyle(style)}
          >
            <b>Edit history</b>
            <ol>
              {newestFirst.map((version, index) => (
                <li key={`${version.at}-${index}`}>
                  <small>
                    {index === 0
                      ? "Current"
                      : index === newestFirst.length - 1
                        ? "Original"
                        : "Earlier"}{" "}
                    · {messageFullTimestamp(version.at)}
                  </small>
                  <p>{version.text ?? "This device never read the original text."}</p>
                </li>
              ))}
            </ol>
          </div>,
        )}
    </>
  );
}
