"use client";

import { useRef, useState } from "react";
import { FiCornerUpLeft, FiImage, FiSend, FiSmile, FiX } from "react-icons/fi";
import { EmojiPicker } from "../chat/EmojiPicker";
import { IMAGE_ACCEPT, imageFileProblem } from "../../hooks/useImageUpload";
import {
  COMMUNITY_COUNTER_FROM_CHARS,
  COMMUNITY_MAX_IMAGES,
  COMMUNITY_MESSAGE_MAX_CHARS,
} from "../../lib/community/communityChat";
import { LocalImage } from "./LocalImage";

/** Writes to the room: Enter sends, Shift+Enter adds a line, a reply shows what it answers, and up to four pictures can be picked, pasted or dropped in. */
export function CommunityComposer({ channel, replyTo, onCancelReply, onSend, disabledReason }) {
  const [draft, setDraft] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [problem, setProblem] = useState(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const trimmed = draft.trim();
  const canSend = Boolean(trimmed) || files.length > 0;
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

  const dropFiles = (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  };

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
      <div
        className="community-composer-row"
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropFiles}
      >
        <textarea
          aria-label={`Message #${channel.name}`}
          maxLength={COMMUNITY_MESSAGE_MAX_CHARS}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={pasteFiles}
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
