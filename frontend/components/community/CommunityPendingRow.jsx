"use client";

import { AvatarFace } from "../AvatarFace";

/** A message still going out, or one that failed and can be retried. */
export function CommunityPendingRow({ entry, user, onRetry, onDiscard }) {
  return (
    <div className={`community-message with-header pending ${entry.status}`}>
      <div className="community-gutter">
        <span className="community-msg-avatar">
          <AvatarFace image={user?.image} name={user?.name} />
        </span>
      </div>
      <div className="community-msg-body">
        <header>
          <b className="community-author">{user?.name}</b>
        </header>
        {entry.replyTo && (
          <p className="community-reply static">
            <b>{entry.replyTo.author?.name ?? "Deleted user"}</b>
            <span>{entry.replyTo.content}</span>
          </p>
        )}
        <p className="community-text">{entry.content}</p>
        {entry.status === "sending" ? (
          <small className="community-pending-note">Sending...</small>
        ) : (
          <small className="community-error" role="alert">
            {entry.error}{" "}
            <button onClick={() => onRetry(entry.clientId)} type="button">
              Retry
            </button>
            {" · "}
            <button onClick={() => onDiscard(entry.clientId)} type="button">
              Discard
            </button>
          </small>
        )}
      </div>
    </div>
  );
}
