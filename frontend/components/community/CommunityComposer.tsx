"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react";
import { FiCornerUpLeft, FiImage, FiSend, FiSmile, FiX } from "react-icons/fi";
import { EmojiPicker } from "../chat/EmojiPicker";
import { IMAGE_ACCEPT, imageFileProblem } from "../../hooks/useImageUpload";
import {
  COMMUNITY_COUNTER_FROM_CHARS,
  COMMUNITY_MAX_IMAGES,
  COMMUNITY_MESSAGE_MAX_CHARS,
} from "../../lib/community/communityChat";
import { useCommunityMemberSuggestions } from "../../hooks/community/useCommunityMemberSuggestions";
import { useMentionPicker } from "../../hooks/useMentionPicker";
import { dragVerdict } from "../../lib/community/dragVerdict";
import type { DragVerdict } from "../../lib/community/dragVerdict";
import type { CommunityMessage } from "../../lib/community/communityChat";
import type { ReactionChoice } from "../../lib/chat/chatReactions";
import { MentionMenu } from "../MentionMenu";
import { LocalImage } from "./LocalImage";

/** Writes to the room: Enter sends, Shift+Enter adds a line, a reply shows what it answers, and up to four pictures can be picked, pasted or dropped in. */
export function CommunityComposer({
  slug,
  channel,
  replyTo,
  onCancelReply,
  onSend,
  disabledReason,
  cooldownSeconds = 0,
}: {
  slug: string;
  channel: { name: string; slowmodeSeconds: number };
  replyTo?: CommunityMessage | null;
  onCancelReply: () => void;
  onSend: (text: string, files: File[]) => void;
  disabledReason?: string | null;
  /** Seconds until sending is allowed again after sending too fast; 0 when it is. */
  cooldownSeconds?: number;
}) {
  const [draft, setDraft] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragVerdict | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trimmed = draft.trim();
  const canSend = (Boolean(trimmed) || files.length > 0) && cooldownSeconds === 0;
  const mention = useMentionPicker(draft, setDraft, inputRef);
  const suggestions = useCommunityMemberSuggestions(slug, mention.query);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.handleKey(event, suggestions.items)) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  const length = Array.from(draft).length;
  const showCounter = length >= COMMUNITY_COUNTER_FROM_CHARS;

  // Keeps what can be sent and says why the rest was left out.
  const addFiles = (incoming: File[]) => {
    const accepted: File[] = [];
    let notice: string | null = null;
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

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    addFiles(picked);
  };

  const pasteFiles = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!pasted.length) return;
    event.preventDefault();
    addFiles(pasted);
  };

  // The whole room is the drop target, and says whether what is being dragged would be taken.
  useEffect(() => {
    const room = inputRef.current?.closest<HTMLElement>(".community-chat");
    if (!room) return undefined;

    const verdictOf = (event: DragEvent) =>
      dragVerdict(event.dataTransfer?.items, COMMUNITY_MAX_IMAGES - files.length, IMAGE_ACCEPT.split(","));
    const over = (event: DragEvent) => {
      const verdict = verdictOf(event);
      if (!verdict) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = verdict.ok ? "copy" : "none";
      setDragging(verdict);
    };
    const leave = (event: DragEvent) => {
      if (!room.contains(event.relatedTarget as Node | null)) setDragging(null);
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      setDragging(null);
      addFiles(Array.from(event.dataTransfer?.files ?? []));
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

  const insertEmoji = (choice: ReactionChoice) => {
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
            mention.onInput(event);
          }}
          onKeyDown={handleKeyDown}
          onPaste={pasteFiles}
          onSelect={mention.onSelect}
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
        <MentionMenu items={suggestions.items} picker={mention} />
        {isPickerOpen && (
          <div className="community-emoji-popover">
            <EmojiPicker emojiOnly onPick={insertEmoji} />
          </div>
        )}
      </div>
      {cooldownSeconds > 0 && (
        <small className="community-error" role="status">
          You&apos;re sending messages too fast. You can send again in {cooldownSeconds}s.
        </small>
      )}
      {channel.slowmodeSeconds > 0 && (
        <small className="community-hint">
          Slow mode: one message every {channel.slowmodeSeconds}s
        </small>
      )}
    </div>
  );
}
