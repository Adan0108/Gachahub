"use client";

import { useRef, useState } from "react";
import {
  FiAlertCircle,
  FiCheck,
  FiClock,
  FiLink,
  FiSearch,
  FiSend,
  FiShare,
  FiX,
} from "react-icons/fi";
import { AvatarFace } from "./AvatarFace";
import { SHARE_RESULT, usePostShare } from "../hooks/chat/usePostShare";
import { useChatConversations } from "../hooks/chat/useChatConversations";
import { USER_SEARCH_MIN_CHARS, useUserSearch } from "../hooks/chat/useUserSearch";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { floatingPortal } from "../hooks/chat/useFloatingPosition";
import { useModalFocusTrap } from "../hooks/chat/useModalFocusTrap";
import { useToast } from "../hooks/useToast";
import { conversationImage, otherActiveMemberIds } from "../lib/chat/chatDisplay";
import { shareStatus, shareTargets } from "../lib/chat/shareTargets";
import "./SharePostDialog.css";

const MAX_NOTE = 1000;
const SKELETON_TILES = 8;

function resultText(result) {
  switch (result.status) {
    case SHARE_RESULT.SENT:
      return "Sent";
    case SHARE_RESULT.REQUESTED:
      return "Message request sent. Share again once they accept.";
    case SHARE_RESULT.WAITING:
      return result.reason || "Can't send here yet";
    default:
      return result.reason || "Could not send";
  }
}

function ResultIcon({ status }) {
  if (status === SHARE_RESULT.SENT) return <FiCheck aria-hidden="true" />;
  if (status === SHARE_RESULT.FAILED) return <FiAlertCircle aria-hidden="true" />;
  return <FiClock aria-hidden="true" />;
}

/** One person or chat to pick: a round picture with the name under it, and a tick once chosen. */
function ShareTile({ tile, selected, disabled, onToggle }) {
  const label = tile.reason ? `${tile.name}, ${tile.reason}` : tile.name;
  return (
    <button
      aria-checked={selected}
      aria-label={label}
      className={`share-post-tile ${selected ? "selected" : ""}`}
      disabled={disabled}
      onClick={() => onToggle(tile)}
      role="checkbox"
      title={tile.reason || undefined}
      type="button"
    >
      <span className="share-post-tile-avatar">
        <AvatarFace image={tile.image} name={tile.name} />
        {selected && (
          <span aria-hidden="true" className="share-post-tile-check">
            <FiCheck />
          </span>
        )}
      </span>
      <span className="share-post-tile-name">{tile.name}</span>
      {tile.reason && <small className="share-post-tile-reason">{tile.reason}</small>}
    </button>
  );
}

/** The chats you can pick, narrowed by the search text, plus people found by search who you have not messaged yet. */
function buildTiles({ conversations, userId, query, found, picked }) {
  const chatTiles = shareTargets(conversations, userId, query).map((target) => ({
    key: `chat:${target.conversation.id}`,
    name: target.name,
    image: conversationImage(target.conversation, userId),
    conversation: target.conversation,
    ok: target.ok,
    reason: target.ok ? null : target.reason,
  }));

  const directByPeer = new Map();
  for (const conversation of conversations || []) {
    if (conversation.type !== "DIRECT") continue;
    for (const peerId of otherActiveMemberIds(conversation, userId))
      directByPeer.set(peerId, conversation);
  }

  const tiles = [...chatTiles];
  const known = new Set(tiles.map((tile) => tile.key));

  for (const person of found) {
    if (person.id === userId) continue;
    const conversation = directByPeer.get(person.id);
    if (conversation) {
      const key = `chat:${conversation.id}`;
      if (known.has(key)) continue;
      const status = shareStatus(conversation, userId);
      tiles.push({
        key,
        name: person.name,
        image: person.image ?? null,
        conversation,
        ok: status.ok,
        reason: status.ok ? null : status.reason,
      });
      known.add(key);
      continue;
    }
    const key = `person:${person.id}`;
    if (known.has(key)) continue;
    tiles.push({
      key,
      name: person.name,
      image: person.image ?? null,
      person: { id: person.id, name: person.name },
      ok: true,
      reason: null,
    });
    known.add(key);
  }

  // People already picked stay on screen even after the search text changes.
  const missing = picked.filter((tile) => !known.has(tile.key));
  return [...missing.map((tile) => ({ ...tile, ok: true, reason: null })), ...tiles];
}

/** Sends one post to chats you have and to people you have not messaged yet. Mounted only while open, so the chat engine starts on demand. */
export function SharePostDialog({ postId, onClose, onCopyLink, onNativeShare }) {
  const { user } = useCurrentUser();
  const conversations = useChatConversations();
  const { canSend, deviceError, sendTo } = usePostShare();
  const openerRef = useRef(null);
  const modalRef = useModalFocusTrap(true, onClose, openerRef);
  const { notice, showNotice } = useToast();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);
  // key -> { name, result } once a send has been tried
  const [results, setResults] = useState(null);
  const search = useUserSearch(query);

  const tiles = buildTiles({
    conversations: conversations.data,
    userId: user?.id,
    query,
    found: search.isActive ? search.items : [],
    picked,
  });
  const pickedKeys = new Set(picked.map((tile) => tile.key));
  const typedTooShort = query.trim().length > 0 && !search.isActive;

  const toggle = (tile) =>
    setPicked((current) =>
      current.some((item) => item.key === tile.key)
        ? current.filter((item) => item.key !== tile.key)
        : [...current, tile],
    );

  const send = async (only) => {
    const share = { postId, caption: note };
    const toSend = only ? picked.filter((tile) => only.includes(tile.key)) : picked;
    setIsSending(true);

    // One at a time: each send is a group encryption step on this device.
    for (const tile of toSend) {
      const result = await sendTo(tile, share);
      setResults((current) => ({
        ...(current ?? {}),
        [tile.key]: { name: tile.name, image: tile.image, result },
      }));
    }
    setIsSending(false);
  };

  const copyLink = async () => {
    await onCopyLink?.();
    showNotice("Link copied");
  };

  const failedKeys = results
    ? Object.entries(results)
        .filter(([, entry]) => entry.result.status === SHARE_RESULT.FAILED)
        .map(([key]) => key)
    : [];

  return floatingPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-labelledby="share-post-title"
        aria-modal="true"
        className="modal share-post-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="share-post-head">
          <span aria-hidden="true" />
          <h2 id="share-post-title">Send to</h2>
          <button aria-label="Close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>

        {!results && (
          <>
            <div className="share-post-search">
              <FiSearch aria-hidden="true" />
              <input
                aria-label="Search"
                autoComplete="off"
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                type="search"
                value={query}
              />
            </div>

            <div aria-label="Send to" className="share-post-grid" role="group">
              {conversations.isLoading &&
                Array.from({ length: SKELETON_TILES }, (_, index) => (
                  <span aria-hidden="true" className="share-post-skeleton" key={index}>
                    <span />
                    <i />
                  </span>
                ))}
              {tiles.map((tile) => (
                <ShareTile
                  disabled={!tile.ok || isSending}
                  key={tile.key}
                  onToggle={toggle}
                  selected={pickedKeys.has(tile.key)}
                  tile={tile}
                />
              ))}
            </div>

            {!conversations.isLoading && tiles.length === 0 && !search.isLoading && (
              <p className="share-post-empty">
                {query.trim()
                  ? "No one found. Try a name or @handle."
                  : "No chats yet. Search for someone to send this to."}
              </p>
            )}
            {search.isActive && search.isLoading && (
              <p className="share-post-empty" role="status">
                Searching...
              </p>
            )}
            {search.isActive && search.error && (
              <p className="share-post-empty" role="alert">
                Could not search.{" "}
                <button className="share-post-link" onClick={search.retry} type="button">
                  Try again
                </button>
              </p>
            )}
            {typedTooShort && (
              <p className="share-post-empty">
                Type at least {USER_SEARCH_MIN_CHARS} characters to find people.
              </p>
            )}
            {picked.some((tile) => tile.person) && (
              <p className="share-post-hint">
                People you do not follow each other with get a message request first, and can see
                the post after accepting.
              </p>
            )}
            {!canSend && (
              <p className="share-post-hint" role="status">
                {deviceError
                  ? "Chat encryption is not ready on this device."
                  : "Setting up encryption..."}
              </p>
            )}

            {picked.length > 0 && (
              <div className="share-post-compose">
                <input
                  aria-label="Add a note"
                  maxLength={MAX_NOTE}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Write a message..."
                  type="text"
                  value={note}
                />
                <button
                  className="share-post-send"
                  disabled={!canSend || isSending}
                  onClick={() => send()}
                  type="button"
                >
                  <FiSend aria-hidden="true" />
                  {isSending
                    ? "Sending..."
                    : picked.length > 1
                      ? `Send to ${picked.length}`
                      : "Send"}
                </button>
              </div>
            )}
          </>
        )}

        {results && (
          <>
            <ul aria-label="Results" className="share-post-results" role="status">
              {Object.entries(results).map(([key, { name, image, result }]) => (
                <li className={result.status} key={key}>
                  <span className="share-post-result-avatar">
                    <AvatarFace image={image} name={name} />
                  </span>
                  <span className="share-post-result-text">
                    <b>{name}</b>
                    <small>{resultText(result)}</small>
                  </span>
                  <ResultIcon status={result.status} />
                </li>
              ))}
            </ul>
            <div className="share-post-compose">
              {failedKeys.length > 0 && (
                <button
                  className="share-post-secondary"
                  disabled={isSending}
                  onClick={() => send(failedKeys)}
                  type="button"
                >
                  Try again
                </button>
              )}
              <button className="share-post-send" onClick={onClose} type="button">
                Done
              </button>
            </div>
          </>
        )}

        <div className="share-post-shortcuts">
          <button onClick={copyLink} type="button">
            <span aria-hidden="true">
              <FiLink />
            </span>
            Copy link
          </button>
          {onNativeShare && (
            <button onClick={onNativeShare} type="button">
              <span aria-hidden="true">
                <FiShare />
              </span>
              More
            </button>
          )}
          {notice && (
            <small className="share-post-toast" role="status">
              {notice}
            </small>
          )}
        </div>
      </div>
    </div>,
  );
}
