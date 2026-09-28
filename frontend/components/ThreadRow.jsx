import { FiLock } from "react-icons/fi";
import { EnvelopeContent } from "./EnvelopeContent";
import { HistoryBanner, MembershipEventLine, TimestampDivider } from "./ThreadNotices";
import { initialOf, participantUser } from "../lib/chatDisplay";
import {
  membershipEventText,
  messageDividerLabel,
  messageFullTimestamp,
  wasLikelySentDuringAbsence,
} from "../lib/chatThread";

/** A message bubble; `decrypted` is this message's ok/unavailable state (pending renders nothing). */
function MessageBubble({
  message,
  decrypted,
  conversation,
  userId,
  allMessages,
  decryptedById,
  index,
  gapBefore,
  groupedWithPrevious,
  groupedWithNext,
}) {
  const mine = message.senderId === userId;
  const sender = participantUser(conversation, message.senderId);
  const sentAt = Date.parse(message.createdAt);
  const rowClass = [
    "chat-message-row",
    mine && "mine",
    gapBefore && "gap-before",
    groupedWithPrevious && "grouped",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={rowClass}>
      {!mine && (
        <span className={`chat-avatar small ${groupedWithNext ? "placeholder" : ""}`}>
          {!groupedWithNext && initialOf(sender?.name)}
        </span>
      )}
      <div className="chat-message-time-wrap">
        <article className={`chat-message ${mine ? "mine" : ""}`}>
          {decrypted.status === "ok" ? (
            <div>
              {!mine && conversation.type === "GROUP" && !groupedWithPrevious && (
                <small>{sender?.name || "GachaHub member"}</small>
              )}
              <EnvelopeContent
                envelope={decrypted.envelope}
                media={message.media}
                messageId={message.id}
              />
            </div>
          ) : (
            <>
              <FiLock aria-hidden="true" />
              <div>
                <b>Message unavailable</b>
                <p>
                  {wasLikelySentDuringAbsence(allMessages, decryptedById, index)
                    ? "Sent while you weren't in the group."
                    : "This device can't decrypt this message."}
                </p>
              </div>
            </>
          )}
        </article>
        {!Number.isNaN(sentAt) && (
          <span className="chat-message-time-tip">{messageFullTimestamp(sentAt)}</span>
        )}
      </div>
    </div>
  );
}

/** One row of the thread: banner, timestamp divider, membership line, "conversation started", or a message. */
export function ThreadRow({ item, conversation, userId, allMessages, decryptedById, now }) {
  if (item.kind === "history-banner") return <HistoryBanner />;
  if (item.kind === "timestamp") return <TimestampDivider label={messageDividerLabel(item.at, now)} />;
  if (item.kind === "event") {
    const { event } = item;
    const name = participantUser(conversation, event.userId)?.name;
    return <MembershipEventLine text={membershipEventText(event, name, event.userId === userId)} />;
  }
  const { message, index, gapBefore, groupedWithPrevious, groupedWithNext } = item;
  if (message.contentType === "SYSTEM") {
    return (
      <div className="chat-system-message">
        <span>Conversation started</span>
      </div>
    );
  }
  const decrypted = decryptedById[message.id];
  // Not decrypted yet (or still retrying) - render nothing so the bubble pops in fully formed.
  if (!decrypted || decrypted.status === "pending") return null;
  return (
    <MessageBubble
      allMessages={allMessages}
      conversation={conversation}
      decrypted={decrypted}
      decryptedById={decryptedById}
      gapBefore={gapBefore}
      groupedWithNext={groupedWithNext}
      groupedWithPrevious={groupedWithPrevious}
      index={index}
      message={message}
      userId={userId}
    />
  );
}
