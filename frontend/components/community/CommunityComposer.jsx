"use client";

import { useRef, useState } from "react";
import { FiCornerUpLeft, FiSend, FiSmile, FiX } from "react-icons/fi";
import { EmojiPicker } from "../chat/EmojiPicker";
import {
  COMMUNITY_COUNTER_FROM_CHARS,
  COMMUNITY_MESSAGE_MAX_CHARS,
} from "../../lib/community/communityChat";

/** Writes to the room: Enter sends, Shift+Enter adds a line, and a reply shows what it answers. */
export function CommunityComposer({ channel, replyTo, onCancelReply, onSend, disabledReason }) {
  const [draft, setDraft] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const inputRef = useRef(null);
  const trimmed = draft.trim();
  const length = Array.from(draft).length;
  const showCounter = length >= COMMUNITY_COUNTER_FROM_CHARS;

  const submit = () => {
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
    setIsPickerOpen(false);
    inputRef.current?.focus();
  };

  const insertEmoji = (choice) => {
    if (choice.kind !== "emoji") return;
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    setDraft(`${draft.slice(0, start)}${choice.emoji}${draft.slice(end)}`);
    setIsPickerOpen(false);
    input?.focus();
  };

  if (disabledReason) {
    return (
      <div className="community-composer disabled" role="status">
        {disabledReason}
      </div>
    );
  }

  return (
    <div className="community-composer">
      {replyTo && (
        <div className="community-composer-reply">
          <FiCornerUpLeft aria-hidden="true" />
          <span>
            Replying to <b>{replyTo.author?.name ?? "Deleted user"}</b>
          </span>
          <button aria-label="Cancel reply" onClick={onCancelReply} type="button">
            <FiX />
          </button>
        </div>
      )}
      <div className="community-composer-row">
        <textarea
          aria-label={`Message #${channel.name}`}
          maxLength={COMMUNITY_MESSAGE_MAX_CHARS}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={`Message #${channel.name}`}
          ref={inputRef}
          rows={1}
          value={draft}
        />
        <div className="community-composer-tools">
          {showCounter && (
            <small className={length >= COMMUNITY_MESSAGE_MAX_CHARS ? "limit" : ""} role="status">
              {length}/{COMMUNITY_MESSAGE_MAX_CHARS}
            </small>
          )}
          <button
            aria-expanded={isPickerOpen}
            aria-label="Add an emoji"
            onClick={() => setIsPickerOpen((open) => !open)}
            type="button"
          >
            <FiSmile />
          </button>
          <button
            aria-label="Send message"
            className="send"
            disabled={!trimmed}
            onClick={submit}
            type="button"
          >
            <FiSend />
          </button>
        </div>
        {isPickerOpen && (
          <div className="community-emoji-popover">
            <EmojiPicker emojiOnly onPick={insertEmoji} />
          </div>
        )}
      </div>
      {channel.slowmodeSeconds > 0 && (
        <small className="community-hint">
          Slow mode: one message every {channel.slowmodeSeconds}s
        </small>
      )}
    </div>
  );
}
