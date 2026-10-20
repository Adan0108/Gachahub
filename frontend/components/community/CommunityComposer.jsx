"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FiCornerUpLeft, FiImage, FiSend, FiSmile, FiX } from "react-icons/fi";
import { EmojiPicker } from "../chat/EmojiPicker";
import { IMAGE_ACCEPT, imageFileProblem } from "../../hooks/useImageUpload";
import {
  COMMUNITY_COUNTER_FROM_CHARS,
  COMMUNITY_MAX_IMAGES,
  COMMUNITY_MESSAGE_MAX_CHARS,
} from "../../lib/community/communityChat";
import { useCommunityMemberSuggestions } from "../../hooks/community/useCommunityMemberSuggestions";
import { typingMention } from "../../lib/mentions";
import { dragVerdict } from "../../lib/community/dragVerdict";
import { AvatarFace } from "../AvatarFace";
import { LocalImage } from "./LocalImage";

/** Writes to the room: Enter sends, Shift+Enter adds a line, a reply shows what it answers, and up to four pictures can be picked, pasted or dropped in. */
export function CommunityComposer({ slug, channel, replyTo, onCancelReply, onSend, disabledReason }) {
  const [draft, setDraft] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [problem, setProblem] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  // Where the @ being typed started, once the person closed its list with Escape
  const [dismissedAt, setDismissedAt] = useState(null);
  const pendingCaret = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const trimmed = draft.trim();
  const canSend = Boolean(trimmed) || files.length > 0;
  const typing = typingMention(draft, caret);
  const isSuggesting = Boolean(typing) && dismissedAt !== typing.start;
  const suggestions = useCommunityMemberSuggestions(slug, isSuggesting ? typing.query : undefined);
  const showSuggestions = isSuggesting && suggestions.items.length > 0;

  // After picking, the caret goes back behind the inserted handle
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const pickMember = (member) => {
    const inserted = `@${member.username} `;
    const position = typing.start + inserted.length;
    setDraft(`${draft.slice(0, typing.start)}${inserted}${draft.slice(typing.end)}`);
    setCaret(position);
    pendingCaret.current = position;
    setHighlighted(0);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (showSuggestions && !event.nativeEvent.isComposing) {
      const count = suggestions.items.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((current) => (current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickMember(suggestions.items[Math.min(highlighted, count - 1)]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedAt(typing.start);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  const length = Array.from(draft).length;
  const showCounter = length >= COMMUNITY_COUNTER_FROM_CHARS;

  // Keeps what can be sent and says why the rest was left out.
  const addFiles = (incoming) => {
    const accepted = [];
    let notice = null;
    for (const file of incoming) {
      const bad = imageFileProblem(file);
      if (bad) {
        notice = `${file.name}: ${bad}`;
      } else if (files.length + accepted.length >= COMMUNITY_MAX_IMAGES) {
        notice = `You can add up to ${COMMUNITY_MAX_IMAGES} images to a message`;
        break;
      } else {
        accepted.push(file);
      }
    }
    setProblem(notice);
    if (accepted.length) setFiles((list) => [...list, ...accepted]);
  };

  const pickFiles = (event) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    addFiles(picked);
  };

  const pasteFiles = (event) => {
    const pasted = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!pasted.length) return;
    event.preventDefault();
    addFiles(pasted);
  };

  // The whole room is the drop target, and says whether what is being dragged would be taken.
  useEffect(() => {
    const room = inputRef.current?.closest(".community-chat");
    if (!room) return undefined;

    const verdictOf = (event) =>
      dragVerdict(event.dataTransfer?.items, COMMUNITY_MAX_IMAGES - files.length, IMAGE_ACCEPT.split(","));
    const over = (event) => {
      const verdict = verdictOf(event);
      if (!verdict) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = verdict.ok ? "copy" : "none";
      setDragging(verdict);
    };
    const leave = (event) => {
      if (!room.contains(event.relatedTarget)) setDragging(null);
    };
    const drop = (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      setDragging(null);
      addFiles(Array.from(event.dataTransfer.files));
    };

    room.addEventListener("dragenter", over);
    room.addEventListener("dragover", over);
    room.addEventListener("dragleave", leave);
    room.addEventListener("drop", drop);
    return () => {
      room.removeEventListener("dragenter", over);
      room.removeEventListener("dragover", over);
      room.removeEventListener("dragleave", leave);
      room.removeEventListener("drop", drop);
    };
    // addFiles only reads `files`, which is already a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, disabledReason]);

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed, files);
    setDraft("");
    setFiles([]);
    setProblem(null);
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
      {dragging && (
        <div
          aria-live="polite"
          className={`community-drop-overlay ${dragging.ok ? "" : "refused"}`}
          role="status"
        >
          <b>{dragging.message}</b>
        </div>
      )}
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
      {files.length > 0 && (
        <ul aria-label="Images to send" className="community-composer-files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <LocalImage file={file} />
              <button
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((list) => list.filter((_, at) => at !== index))}
                type="button"
              >
                <FiX />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <small className="community-error" role="alert">
          {problem}
        </small>
      )}
      <div className="community-composer-row">
        <textarea
          aria-label={`Message #${channel.name}`}
          maxLength={COMMUNITY_MESSAGE_MAX_CHARS}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setHighlighted(0);
          }}
          onKeyDown={handleKeyDown}
          onPaste={pasteFiles}
          onSelect={(event) => setCaret(event.target.selectionStart ?? 0)}
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
          <input
            accept={IMAGE_ACCEPT}
            aria-label="Choose images"
            hidden
            multiple
            onChange={pickFiles}
            ref={fileInputRef}
            type="file"
          />
          <button
            aria-label="Add images"
            disabled={files.length >= COMMUNITY_MAX_IMAGES}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <FiImage />
          </button>
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
            disabled={!canSend}
            onClick={submit}
            type="button"
          >
            <FiSend />
          </button>
        </div>
        {showSuggestions && (
          <ul aria-label="Suggested members" className="community-mention-menu" role="listbox">
            {suggestions.items.map((member, index) => (
              <li
                aria-selected={index === highlighted}
                className={index === highlighted ? "active" : ""}
                key={member.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickMember(member);
                }}
                onMouseEnter={() => setHighlighted(index)}
                role="option"
              >
                <span className="chat-avatar small">
                  <AvatarFace image={member.image} name={member.name} />
                </span>
                <span className="community-mention-name">{member.name}</span>
                <span className="community-mention-handle">@{member.username}</span>
              </li>
            ))}
          </ul>
        )}
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
