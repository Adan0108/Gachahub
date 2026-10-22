"use client";

import { AvatarFace } from "../AvatarFace";
import { quoteText } from "../../lib/community/communityChat";
import { LocalImage } from "./LocalImage";
import type { PendingCommunityMessage } from "../../hooks/community/useCommunityChat";

/** A message still going out, or one that failed and can be retried. */
export function CommunityPendingRow({
  entry,
  user,
  onRetry,
  onDiscard,
}: {
  entry: PendingCommunityMessage;
  user?: { name?: string | null; image?: string | null } | null;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
}) {
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
            <span>{quoteText(entry.replyTo)}</span>
          </p>
        )}
        {entry.content && <p className="community-text">{entry.content}</p>}
        {entry.files?.length > 0 && (
          <div className={`community-media count-${entry.files.length}`}>
            {entry.files.map((file: File, index: number) => (
              <span key={`${file.name}-${index}`}>
                <LocalImage file={file} />
              </span>
            ))}
          </div>
        )}
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
