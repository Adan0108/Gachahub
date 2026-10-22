"use client";

import { useEffect, useRef } from "react";
import { FiX } from "react-icons/fi";
import { floatingPortal } from "../../hooks/chat/useFloatingPosition";
import { useModalFocusTrap } from "../../hooks/chat/useModalFocusTrap";

/** Asks before something that cannot be taken back; it starts on Cancel so a stray Enter does nothing harmful, and sits on top of the whole page. */
export function ConfirmChatActionDialog({
  isOpen,
  title,
  body,
  confirmLabel,
  isPending,
  error,
  onConfirm,
  onClose,
  className = "",
}: {
  isOpen: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  isPending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  className?: string;
}) {
  const openerRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useModalFocusTrap(isOpen, onClose, openerRef);

  useEffect(() => {
    if (!isOpen) return;
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  return floatingPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-describedby="confirm-chat-action-body"
        aria-labelledby="confirm-chat-action-title"
        aria-modal="true"
        className={`modal remove-message-modal ${className}`}
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="remove-message-head">
          <h2 id="confirm-chat-action-title">{title}</h2>
          <button aria-label="Close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>

        <p className="confirm-chat-action-body" id="confirm-chat-action-body">
          {body}
        </p>
        {error && (
          <p className="chat-info-error" role="alert">
            {error}
          </p>
        )}

        <div className="remove-message-actions">
          <button className="remove-message-cancel" onClick={onClose} ref={cancelRef} type="button">
            Cancel
          </button>
          <button
            className="remove-message-confirm danger"
            disabled={isPending}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
  );
}
