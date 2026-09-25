import { FiLock } from "react-icons/fi";
import { EnvelopeContent } from "./EnvelopeContent";
import { HistoryBanner, MembershipEventLine } from "./ThreadNotices";
import { initialOf, participantUser, relativeTime } from "../lib/chatDisplay";
import { membershipEventText, wasLikelySentDuringAbsence } from "../lib/chatThread";

/** A message bubble; `decrypted` is this message's ok/unavailable state (pending renders nothing). */
function MessageBubble({
  message,
  decrypted,
  conversation,
  userId,
  allMessages,
  decryptedById,
  index,
}) {
  const mine = message.senderId === userId;
  const sender = participantUser(conversation, message.senderId);
  return (
    <div className={`chat-message-row ${mine ? "mine" : ""}`}>
      {!mine && <span className="chat-avatar small">{initialOf(sender?.name)}</span>}
      <article className={`chat-message ${mine ? "mine" : ""}`}>
        {decrypted.status === "ok" ? (
          <div>
            {!mine && conversation.type === "GROUP" && (
              <small>{sender?.name || "GachaHub member"}</small>
            )}
            <EnvelopeContent
              envelope={decrypted.envelope}
              media={message.media}
              messageId={message.id}
            />
            <small>{relativeTime(message.createdAt)}</small>
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
              <small>{relativeTime(message.createdAt)}</small>
            </div>
          </>
        )}
      </article>
    </div>
  );
}

/** One row of the thread: banner, membership line, "conversation started", or a message. */
export function ThreadRow({ item, conversation, userId, allMessages, decryptedById }) {
  if (item.kind === "history-banner") return <HistoryBanner />;
  if (item.kind === "event") {
    const { event } = item;
    const name = participantUser(conversation, event.userId)?.name;
    return <MembershipEventLine text={membershipEventText(event, name, event.userId === userId)} />;
  }
  const { message, index } = item;
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
      index={index}
      message={message}
      userId={userId}
    />
  );
}
