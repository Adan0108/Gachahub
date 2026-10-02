import { FiCornerUpLeft, FiFile, FiLock } from "react-icons/fi";
import { EnvelopeContent } from "./EnvelopeContent";
import { MessageActions } from "./MessageActions";
import { HistoryBanner, MembershipEventLine, TimestampDivider } from "./ThreadNotices";
import { useAttachmentBlobUrl } from "../../hooks/chat/useAttachmentBlobUrl";
import { groupReactions } from "../../lib/chat/chatReactions";
import { initialOf, participantUser } from "../../lib/chat/chatDisplay";
import {
  attachmentKind,
  envelopeView,
  isMediaOnlyView,
  resolveAttachmentSources,
} from "../../lib/mls/media/attachmentView";
import {
  membershipEventText,
  messageDividerLabel,
  messageFullTimestamp,
  replyOriginalSenderLabel,
  wasLikelySentDuringAbsence,
} from "../../lib/chat/chatThread";

/** The small preview inside a reply quote: the file's own thumbnail (dimmed), or a plain file icon for anything else. */
function ReplyQuoteMedia({ replyToId, file, media }) {
  const isFile = attachmentKind(file.mime) === "file";
  const urlByUploadId = new Map((media || []).map((item) => [item.mediaUploadId, item.url]));
  const { visual } = resolveAttachmentSources(replyToId, [file], urlByUploadId);
  // Only ever the thumbnail, never the full file - a reply quote isn't worth decrypting a whole video for.
  const thumbSource = visual[0]?.thumbSource ?? null;
  const preview = useAttachmentBlobUrl(thumbSource, !isFile);

  if (isFile) {
    return (
      <span className="chat-reply-quote-file">
        <FiFile aria-hidden="true" /> {file.name}
      </span>
    );
  }
  if (preview.status === "ready") {
    return <img alt="" className="chat-reply-quote-thumb" src={preview.url} />;
  }
  return <span>an attachment</span>;
}

/** "X replied to Y" - sits above the quote, sized to its own text rather than matching the bubble below it. */
function ReplyLabel({ message, conversation, messagesById, userId }) {
  if (!message.replyToId) return null;
  const mine = message.senderId === userId;
  const replierLabel = mine ? "You" : participantUser(conversation, message.senderId)?.name || "Someone";
  const original = messagesById.get(message.replyToId) ?? message.replyTo;
  const originalSenderLabel = replyOriginalSenderLabel(
    message.senderId,
    original?.senderId,
    userId,
    participantUser(conversation, original?.senderId)?.name,
  );
  return (
    <div className="chat-reply-label">
      <FiCornerUpLeft aria-hidden="true" />
      {replierLabel} replied to {originalSenderLabel}
    </div>
  );
}

/** The quoted original, sized to match the reply bubble right under it. Click jumps to it. */
function ReplyQuote({ message, messagesById, decryptedById, onJumpToMessage }) {
  if (!message.replyToId) return null;
  const original = messagesById.get(message.replyToId) ?? message.replyTo;
  const decrypted = decryptedById[message.replyToId];
  const view = decrypted?.status === "ok" ? envelopeView(decrypted.envelope) : null;

  return (
    <button className="chat-reply-quote" onClick={() => onJumpToMessage(message.replyToId)} type="button">
      {view?.kind === "text" && <span className="chat-reply-quote-text">{view.text}</span>}
      {view?.kind === "attachment" && view.files[0] && (
        <ReplyQuoteMedia file={view.files[0]} media={original?.media} replyToId={message.replyToId} />
      )}
      {!view && <span>a message</span>}
    </button>
  );
}

function ReactionChips({ reactions, userId, onToggle }) {
  const groups = groupReactions(reactions, userId);
  if (!groups.length) return null;
  return (
    <div className="chat-reaction-chips">
      {groups.map((group) => (
        <button
          className={group.mine ? "mine" : ""}
          key={group.emoji}
          onClick={() => onToggle(group.emoji, group.mine)}
          type="button"
        >
          {group.emoji} {group.count}
        </button>
      ))}
    </div>
  );
}

/** A message bubble; `decrypted` is this message's ok/unavailable state (pending renders nothing). */
function MessageBubble({
  message,
  decrypted,
  conversation,
  userId,
  messagesById,
  decryptedById,
  neighbors,
  index,
  gapBefore,
  groupedWithPrevious,
  groupedWithNext,
  onReply,
  onReact,
  onCopy,
  onDelete,
  onDeleteForMe,
  onJumpToMessage,
}) {
  const mine = message.senderId === userId;
  const sender = participantUser(conversation, message.senderId);
  const sentAt = Date.parse(message.createdAt);
  const view = decrypted.status === "ok" ? envelopeView(decrypted.envelope) : null;
  const mediaOnly = isMediaOnlyView(view);
  const copyText = view?.kind === "text" ? view.text : view?.kind === "attachment" ? view.caption : "";
  const showSenderName = !mine && conversation.type === "GROUP" && !groupedWithPrevious;
  const rowClass = ["chat-message-row", mine && "mine"].filter(Boolean).join(" ");
  // The gap-before/grouped spacing lives on this wrapper, not rowClass - it's the actual
  // .chat-messages flex child now, so putting the margin on both would double it up.
  const hoverZoneClass = [
    "chat-message-hover-zone",
    mine && "mine",
    gapBefore && "gap-before",
    groupedWithPrevious && "grouped",
  ]
    .filter(Boolean)
    .join(" ");

  const body =
    decrypted.status === "ok" ? (
      mediaOnly ? (
        <EnvelopeContent envelope={decrypted.envelope} media={message.media} messageId={message.id} />
      ) : (
        <article className={`chat-message ${mine ? "mine" : ""}`}>
          <EnvelopeContent envelope={decrypted.envelope} media={message.media} messageId={message.id} />
        </article>
      )
    ) : (
      <article className={`chat-message ${mine ? "mine" : ""}`}>
        <FiLock aria-hidden="true" />
        <div>
          <b>Message unavailable</b>
          <p>
            {wasLikelySentDuringAbsence(neighbors, index)
              ? "Sent while you weren't in the group."
              : "This device can't decrypt this message."}
          </p>
        </div>
      </article>
    );

  return (
    <div className={hoverZoneClass}>
      <div className={rowClass} id={`chat-message-${message.id}`}>
        {!mine && (
          <span className={`chat-avatar small ${groupedWithNext ? "placeholder" : ""}`}>
            {!groupedWithNext && initialOf(sender?.name)}
          </span>
        )}
        <div className="chat-message-time-wrap">
          {showSenderName && (
            <small className="chat-message-sender">{sender?.name || "GachaHub member"}</small>
          )}
          <MessageActions
            canCopy={Boolean(copyText)}
            isMine={mine}
            onCopy={() => onCopy(copyText)}
            onDelete={() => onDelete(message.id)}
            onDeleteForMe={() => onDeleteForMe(message.id)}
            onReact={(emoji) => onReact(message.id, emoji)}
            onReply={() =>
              onReply({
                id: message.id,
                senderName: mine ? "yourself" : sender?.name || "GachaHub member",
                preview: copyText ? copyText.slice(0, 80) : "an attachment",
              })
            }
          />
          <ReplyLabel
            conversation={conversation}
            message={message}
            messagesById={messagesById}
            userId={userId}
          />
          <div className="chat-reply-and-bubble">
            <ReplyQuote
              decryptedById={decryptedById}
              message={message}
              messagesById={messagesById}
              onJumpToMessage={onJumpToMessage}
            />
            {body}
          </div>
          {!Number.isNaN(sentAt) && (
            <span className="chat-message-time-tip">{messageFullTimestamp(sentAt)}</span>
          )}
          <ReactionChips
            onToggle={(emoji, mineAlready) => onReact(message.id, emoji, mineAlready)}
            reactions={message.reactions}
            userId={userId}
          />
        </div>
      </div>
    </div>
  );
}

/** One row of the thread: banner, timestamp divider, membership line, "conversation started", a deleted notice, or a message. */
export function ThreadRow({
  item,
  conversation,
  userId,
  messagesById,
  decryptedById,
  neighbors,
  now,
  onReply,
  onReact,
  onCopy,
  onDelete,
  onDeleteForMe,
  onJumpToMessage,
}) {
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
  if (message.status === "DELETED") {
    const mine = message.senderId === userId;
    return (
      <div className={`chat-message-row ${mine ? "mine" : ""}`} id={`chat-message-${message.id}`}>
        <article className={`chat-message deleted ${mine ? "mine" : ""}`}>
          <p>{mine ? "You unsent a message" : "This message was unsent"}</p>
        </article>
      </div>
    );
  }
  const decrypted = decryptedById[message.id];
  // Not decrypted yet (or still retrying) - render nothing so the bubble pops in fully formed.
  if (!decrypted || decrypted.status === "pending") return null;
  return (
    <MessageBubble
      messagesById={messagesById}
      conversation={conversation}
      decrypted={decrypted}
      decryptedById={decryptedById}
      neighbors={neighbors}
      gapBefore={gapBefore}
      groupedWithNext={groupedWithNext}
      groupedWithPrevious={groupedWithPrevious}
      index={index}
      message={message}
      onCopy={onCopy}
      onDelete={onDelete}
      onDeleteForMe={onDeleteForMe}
      onJumpToMessage={onJumpToMessage}
      onReact={onReact}
      onReply={onReply}
      userId={userId}
    />
  );
}
