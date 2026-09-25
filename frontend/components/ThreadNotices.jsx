import { FiLock } from "react-icons/fi";

/** One calm line standing in for every message that predates this device joining. */
export function HistoryBanner() {
  return (
    <div className="chat-history-ceiling" role="note">
      <FiLock aria-hidden="true" /> Messages sent before this device joined can&apos;t be shown here
    </div>
  );
}

/** A membership change this device verified, as a system line in the thread. */
export function MembershipEventLine({ text }) {
  return (
    <div className="chat-system-message">
      <span>{text}</span>
    </div>
  );
}
