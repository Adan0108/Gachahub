"use client";

import { useEffect, useRef } from "react";
import { FiCheck, FiShield, FiX } from "react-icons/fi";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import { SAFETY_CHANGED_TEXT } from "./SafetyStatus";

function NumberBlock({ label, digits, large = false }) {
  return (
    <div className="safety-number-block">
      <small>{label}</small>
      <code className={large ? "safety-number large" : "safety-number"}>{digits}</code>
    </div>
  );
}

/** Shows the numbers two people compare out-of-band; `safety` is one peer's entry from useSafetyNumbers. */
export function SafetyNumberModal({
  isOpen,
  peerName,
  safety,
  hasError,
  onRetry,
  onVerify,
  onClose,
}) {
  // The opener still has focus when the modal opens, so remember it to refocus on close.
  const openerRef = useRef(null);
  const modalRef = useModalFocusTrap(isOpen, onClose, openerRef);
  useEffect(() => {
    if (isOpen) openerRef.current = document.activeElement;
  }, [isOpen]);
  if (!isOpen) return null;

  const hasNumbers = Boolean(safety?.pairNumber);
  const isVerified = safety?.status === "verified";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-labelledby="safety-number-title"
        aria-modal="true"
        className="modal safety-number-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="panel-head">
          <h2 id="safety-number-title">Verify {peerName}</h2>
          <button aria-label="Close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>
        {hasNumbers ? (
          <>
            <p className="safety-number-help">
              Compare this number with {peerName} in person or over a call you trust. If it matches
              on both screens, your messages are private between you. Verifying covers all your
              chats with {peerName}.
            </p>
            <NumberBlock digits={safety.pairNumber} label="Safety number" large />
            <details className="safety-number-details">
              <summary>Each person&apos;s number</summary>
              <NumberBlock digits={safety.yourNumber} label="Yours" />
              <NumberBlock digits={safety.theirNumber} label={peerName} />
            </details>
            {safety.status === "new-device" && (
              <small className="safety-number-help">{peerName} added a new device - compare and verify again.</small>
            )}
            {safety.status === "changed" && (
              <small className="safety-number-warning" role="alert">
                {SAFETY_CHANGED_TEXT}
              </small>
            )}
            <div className="safety-number-actions">
              <button disabled={isVerified} onClick={onVerify} type="button">
                {isVerified ? (
                  <>
                    <FiShield /> Verified
                  </>
                ) : (
                  <>
                    <FiCheck /> Mark as verified
                  </>
                )}
              </button>
            </div>
          </>
        ) : hasError ? (
          <>
            <p className="safety-number-help" role="alert">
              Couldn&apos;t read the encrypted group to work out the safety number.
            </p>
            <div className="safety-number-actions">
              <button onClick={onRetry} type="button">
                Try again
              </button>
            </div>
          </>
        ) : (
          <p className="safety-number-help">
            Numbers aren&apos;t available yet - this device hasn&apos;t joined the encrypted group.
          </p>
        )}
      </div>
    </div>
  );
}
