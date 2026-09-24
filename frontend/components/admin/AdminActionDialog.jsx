"use client";

import { FiAlertTriangle, FiX } from "react-icons/fi";

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
}) {
  return (
    <div
      className="admin-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !pending && onClose()}
    >
      <section
        aria-labelledby="admin-action-title"
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
        <h2 id="admin-action-title">{title}</h2>
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
