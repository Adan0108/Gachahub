"use client";

import { useEffect, useRef, useState } from "react";
import { FiX } from "react-icons/fi";
import { useModalFocusTrap } from "../../hooks/chat/useModalFocusTrap";

const OPTIONS = [
  {
    scope: "everyone",
    label: "Remove for everyone",
    help: "The message and any edits are deleted for every member of this chat. This can't be undone.",
  },
  {
    scope: "me",
    label: "Hide on this device",
    help: "Hidden on this device only. Everyone else still sees it, and you can undo this right after.",
  },
];

/**
 * Asks how to remove a message. Your own can be removed for everyone or hidden on this device;
 * someone else's can only be hidden on this device. `target` is { id, mine } or null while closed; `onConfirm` gets
 * "everyone" or "me".
 */
export function RemoveMessageDialog({ target, onConfirm, onClose }) {
  const isOpen = Boolean(target);
  const [scope, setScope] = useState("everyone");
  const [shownFor, setShownFor] = useState(target?.id);
  const openerRef = useRef(null);
  const firstFieldRef = useRef(null);
  const modalRef = useModalFocusTrap(isOpen, onClose, openerRef);

  // Each message starts on the safest-to-explain choice, not on whatever the last one was left on.
  if (target?.id !== shownFor) {
    setShownFor(target?.id);
    setScope("everyone");
  }

  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement;
    firstFieldRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const options = target.mine ? OPTIONS : OPTIONS.slice(1);
  const chosen = target.mine ? scope : "me";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-labelledby="remove-message-title"
        aria-modal="true"
        className="modal remove-message-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="remove-message-head">
          <h2 id="remove-message-title">
            {target.mine ? "Remove this message?" : "Hide this message?"}
          </h2>
          <button aria-label="Close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>

        <div aria-labelledby="remove-message-title" className="remove-message-options" role="radiogroup">
          {options.map((option, index) => (
            <label className="remove-message-option" key={option.scope}>
              <input
                checked={chosen === option.scope}
                name="remove-message-scope"
                onChange={() => setScope(option.scope)}
                ref={index === 0 ? firstFieldRef : undefined}
                type="radio"
                value={option.scope}
              />
              <span>
                <b>{option.label}</b>
                <small>{option.help}</small>
              </span>
            </label>
          ))}
        </div>

        <div className="remove-message-actions">
          <button className="remove-message-cancel" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="remove-message-confirm" onClick={() => onConfirm(chosen)} type="button">
            {chosen === "everyone" ? "Remove" : "Hide"}
          </button>
        </div>
      </div>
    </div>
  );
}
