"use client";

import { useState } from "react";
import { FiCornerUpLeft } from "react-icons/fi";
import { AvatarFace } from "../AvatarFace";
import { LinkifiedText } from "../chat/LinkifiedText";
import { MessageActions } from "../chat/MessageActions";
import { ReactionChips } from "../chat/ReactionChips";
import {
  COMMUNITY_MESSAGE_MAX_CHARS,
  canEditCommunityMessage,
} from "../../lib/community/communityChat";

const BADGE_LABEL = { ADMIN: "Admin", MODERATOR: "Mod" };

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" });

function Author({ author }) {
  return (
    <>
      <b className="community-author">{author?.name ?? "Deleted user"}</b>
      {author?.badge && (
        <span className={`community-badge ${author.badge.toLowerCase()}`}>
          {BADGE_LABEL[author.badge]}
        </span>
      )}
    </>
  );
}

/** Edits a message in place: Enter saves, Escape cancels. */
function EditBox({ initial, isSaving, error, onSave, onCancel }) {
  const [draft, setDraft] = useState(initial);
  const unchanged = draft.trim() === initial.trim();

  return (
    <div className="community-edit">
      <textarea
        aria-label="Edit message"
        autoFocus
        maxLength={COMMUNITY_MESSAGE_MAX_CHARS}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!unchanged && draft.trim()) onSave(draft);
          }
        }}
        rows={2}
        value={draft}
      />
      <small>Escape to cancel, Enter to save</small>
      {error && (
        <small className="community-error" role="alert">
          {error}
        </small>
      )}
      <div>
        <button disabled={isSaving} onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="primary"
          disabled={isSaving || unchanged || !draft.trim()}
          onClick={() => onSave(draft)}
          type="button"
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** One message of the room: picture and name on the first of a run, then text, reply quote and reactions; the hover toolbar acts on it. */
export function CommunityMessageRow({
  message,
  showHeader,
  userId,
  canModerate,
  now,
  editState,
  onReply,
  onReact,
  onSaveEdit,
  onRemove,
  onJumpTo,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const at = new Date(message.createdAt);
  const isOwn = Boolean(userId) && message.author?.id === userId;
  const canEdit = canEditCommunityMessage(message, userId, now);
  const myReaction = message.reactions.find((reaction) => reaction.userId === userId);

  const save = async (content) => {
    try {
      await onSaveEdit(message.id, content);
      setIsEditing(false);
    } catch {
      // The error is shown under the box; it stays open so nothing typed is lost.
    }
  };

  // Someone you blocked: the place is kept so the room has no holes, and nothing else shows.
  if (message.blocked) {
    return (
      <div className="community-message removed" id={`community-message-${message.id}`}>
        <div className="community-gutter" />
        <div className="community-msg-body">
          <p className="community-removed">Blocked message</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`community-message ${showHeader ? "with-header" : ""} ${message.deleted ? "removed" : ""}`}
      id={`community-message-${message.id}`}
    >
      <div className="community-gutter">
        {showHeader ? (
          <span className="community-msg-avatar">
            <AvatarFace image={message.author?.image} name={message.author?.name} />
          </span>
        ) : (
          <time
            className="community-hover-time"
            dateTime={message.createdAt}
            title={fullFormat.format(at)}
          >
            {timeFormat.format(at)}
          </time>
        )}
      </div>

      <div className="community-msg-body">
        {showHeader && (
          <header>
            <Author author={message.author} />
            <time dateTime={message.createdAt} title={fullFormat.format(at)}>
              {timeFormat.format(at)}
            </time>
          </header>
        )}

        {message.replyTo && (
          <button
            className="community-reply"
            onClick={() => onJumpTo(message.replyTo.id)}
            type="button"
          >
            <FiCornerUpLeft aria-hidden="true" />
            {!message.replyTo.blocked && <b>{message.replyTo.authorName ?? "Deleted user"}</b>}
            <span>
              {message.replyTo.blocked
                ? "Blocked message"
                : message.replyTo.deleted
                  ? "Message removed"
                  : message.replyTo.content}
            </span>
          </button>
        )}

        {message.deleted ? (
          <p className="community-removed">Message removed</p>
        ) : isEditing ? (
          <EditBox
            error={editState.error}
            initial={message.content}
            isSaving={editState.isPending}
            onCancel={() => {
              editState.reset?.();
              setIsEditing(false);
            }}
            onSave={save}
          />
        ) : (
          <p className="community-text">
            <LinkifiedText text={message.content} />
            {message.editedAt && <small className="community-edited"> (edited)</small>}
          </p>
        )}

        {!message.deleted && (
          <ReactionChips
            onToggle={(choice, mine) => onReact(message.id, mine ? null : choice)}
            reactions={message.reactions}
            userId={userId}
          />
        )}
      </div>

      {!message.deleted && !isEditing && (
        <MessageActions
          canCopy
          canEdit={canEdit}
          canRemove={isOwn || canModerate}
          onCopy={() => navigator.clipboard?.writeText(message.content)}
          onEdit={() => setIsEditing(true)}
          onReact={(choice) =>
            onReact(message.id, myReaction && sameChoice(myReaction, choice) ? null : choice)
          }
          onRemove={() => onRemove(message)}
          onReply={() => onReply(message)}
        />
      )}
    </div>
  );
}

/** Whether a reaction already on a message is the one being picked again, which takes it back. */
function sameChoice(reaction, choice) {
  return choice.kind === "emote"
    ? reaction.emoteId === choice.emote.id
    : reaction.emoji === choice.emoji;
}
