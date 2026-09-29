"use client";

import { FiAlertTriangle, FiShield } from "react-icons/fi";

export const SAFETY_CHANGED_TEXT = "Safety number changed - verify again.";

/** Verified or New device badge, or a Verify button for anyone unverified. Renders nothing without numbers. */
export function SafetyBadge({ safety, onVerify }) {
  if (!safety?.pairNumber) return null;
  if (safety.status === "verified") {
    return (
      <button
        className="safety-badge verified"
        onClick={onVerify}
        title="Safety number verified"
        type="button"
      >
        <FiShield /> Verified
      </button>
    );
  }
  if (safety.status === "new-device") {
    return (
      <button className="safety-badge" onClick={onVerify} title="Added a device you have not verified" type="button">
        <FiShield /> New device
      </button>
    );
  }
  return (
    <button className="safety-badge" onClick={onVerify} type="button">
      <FiShield /> Verify
    </button>
  );
}

/** Red alert for verified peers whose device key changed, plus a quiet hint per peer with a new device. */
export function SafetyChangedBanner({ peers, onVerify }) {
  const changed = peers.filter((peer) => peer.safety?.status === "changed");
  const added = peers.filter((peer) => peer.safety?.status === "new-device");
  if (!changed.length && !added.length) return null;
  return (
    <>
      {changed.length > 0 && (
        <div className="safety-changed-banner" role="alert">
          <FiAlertTriangle aria-hidden="true" /> {SAFETY_CHANGED_TEXT}{" "}
          {changed.map((peer) => (
            <button key={peer.id} onClick={() => onVerify(peer.id)} type="button">
              Verify {peer.name}
            </button>
          ))}
        </div>
      )}
      {added.map((peer) => (
        <div className="safety-changed-banner" key={peer.id}>
          {peer.name} added a new device -{" "}
          <button onClick={() => onVerify(peer.id)} type="button">
            verify it
          </button>
        </div>
      ))}
    </>
  );
}
