"use client";

import { FiAlertTriangle, FiX } from "react-icons/fi";
import { useEffect, useId, useRef } from "react";

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
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = dialogRef.current;
    const fallback = dialog?.closest(".moderation-workspace")?.querySelector("nav a");
    (
      dialog?.querySelector("textarea, input") ||
      dialog?.querySelector("button:not([disabled])") ||
      dialog
    )?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
      else fallback?.focus();
    };
  }, []);
  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!pending) onClose();
    }
    if (event.key !== "Tab") return;
    const items = [
      ...dialogRef.current.querySelectorAll(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      ),
    ];
    const first = items[0];
    const last = items.at(-1);
    if (!first) {
      event.preventDefault();
      dialogRef.current.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
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
