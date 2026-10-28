"use client";

import { FiAlertTriangle, FiX } from "react-icons/fi";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
interface DialogProps {
  title: string;
  description: string;
  children?: ReactNode;
  error?: string;
  pending?: boolean;
  confirmLabel: string;
  pendingLabel?: string;
  confirmDisabled?: boolean;
  tone?: string;
  className?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function AdminActionDialog({
  title,
  description,
  children,
  error,
  pending,
  confirmLabel,
  pendingLabel,
  confirmDisabled = false,
  tone = "danger",
  onClose,
  onConfirm,
  className = "",
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const fallback = dialog?.closest(".moderation-workspace")?.querySelector<HTMLElement>("nav a");
    (
      dialog?.querySelector<HTMLElement>("textarea, input") ||
      dialog?.querySelector<HTMLElement>("button:not([disabled])") ||
      dialog
    )?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
      else fallback?.focus();
    };
  }, []);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current;
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!pending) onClose();
    }
    if (event.key !== "Tab" || !dialog) return;
    const items = [
      ...dialog.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      ),
    ];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div
      className={`admin-dialog-backdrop ${className}`}
      onMouseDown={(event) => event.target === event.currentTarget && !pending && onClose()}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        aria-labelledby={titleId}
        aria-modal="true"
        className="admin-dialog admin-action-dialog"
        role="alertdialog"
      >
        <div className="admin-action-heading">
          <span className={`admin-action-icon admin-action-icon-${tone}`}>
            <FiAlertTriangle />
          </span>
          <button aria-label="Close" disabled={pending} onClick={onClose} type="button">
            <FiX />
          </button>
        </div>
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        {children}
        {error ? (
          <p className="admin-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="admin-form-actions">
          <button
            className="admin-button admin-button-secondary"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className={`admin-button admin-button-${tone}`}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
            type="button"
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
