"use client";

import { useRef, useState } from "react";
import { FiCheck, FiLink, FiShare, FiX } from "react-icons/fi";
import { UserPicker } from "./chat/UserPicker";
import { AvatarFace } from "./AvatarFace";
import { SHARE_RESULT, usePostShare } from "../hooks/chat/usePostShare";
import { useChatConversations } from "../hooks/chat/useChatConversations";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { floatingPortal } from "../hooks/chat/useFloatingPosition";
import { useModalFocusTrap } from "../hooks/chat/useModalFocusTrap";
import { conversationImage } from "../lib/chat/chatDisplay";
import { shareTargets } from "../lib/chat/shareTargets";
import "./SharePostDialog.css";

const MAX_NOTE = 1000;

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

/** Sends one post to chats you have and to people you have not messaged yet. Mounted only while open, so the chat engine starts on demand. */
export function SharePostDialog({ postId, onClose, onCopyLink, onNativeShare }) {
  const { user } = useCurrentUser();
  const conversations = useChatConversations();
  const { canSend, deviceError, sendTo } = usePostShare();
  const modalRef = useModalFocusTrap(true, onClose, useRef(null));
  const [query, setQuery] = useState("");
  const [chosenIds, setChosenIds] = useState([]);
  const [people, setPeople] = useState([]);
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);
  // key -> { name, result } once a send has been tried
  const [results, setResults] = useState(null);

  const targets = shareTargets(conversations.data, user?.id, query);
  const selectedCount = chosenIds.length + people.length;

  const toggleChat = (id) =>
    setChosenIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const buildTargets = () => [
    ...chosenIds.flatMap((id) => {
      const target = targets.find((item) => item.conversation.id === id);
      const conversation =
        target?.conversation ?? (conversations.data || []).find((item) => item.id === id);
      return conversation
        ? [{ key: `chat:${id}`, name: target?.name ?? "Chat", conversation }]
        : [];
    }),
    ...people.map((person) => ({ key: `person:${person.id}`, name: person.name, person })),
  ];

  const send = async (only) => {
    const share = { postId, caption: note };
    const toSend = only
      ? buildTargets().filter((target) => only.includes(target.key))
      : buildTargets();
    setIsSending(true);

    // One at a time: each send is a group encryption step on this device.
    for (const target of toSend) {
      const result = await sendTo(target, share);
      setResults((current) => ({
        ...(current ?? {}),
        [target.key]: { name: target.name, result },
      }));
    }
    setIsSending(false);
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
          <h2 id="share-post-title">Send post</h2>
          <button aria-label="Close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>

        {!results && (
          <>
            <input
              aria-label="Search your chats"
              className="share-post-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your chats"
              type="search"
              value={query}
            />

            <ul aria-label="Your chats" className="share-post-list">
              {conversations.isLoading && <li className="share-post-empty">Loading chats...</li>}
              {!conversations.isLoading && targets.length === 0 && (
                <li className="share-post-empty">No chats match.</li>
              )}
              {targets.map((target) => {
                const { conversation } = target;
                const checked = chosenIds.includes(conversation.id);
                return (
                  <li key={conversation.id}>
                    <label className={`share-post-row ${target.ok ? "" : "disabled"}`}>
                      <input
                        checked={checked}
                        disabled={!target.ok || isSending}
                        onChange={() => toggleChat(conversation.id)}
                        type="checkbox"
                      />
                      <span className="share-post-avatar">
                        <AvatarFace
                          image={conversationImage(conversation, user?.id)}
                          name={target.name}
                        />
                      </span>
                      <span className="share-post-name">
                        <b>{target.name}</b>
                        {!target.ok && <small>{target.reason}</small>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="share-post-people">
              <span>Someone new</span>
              <UserPicker
                currentUser={user}
                disabled={isSending}
                label="Find people to send to"
                multiple
                onChange={setPeople}
                placeholder="Search by name or @handle..."
                value={people}
              />
              <small>
                If you do not follow each other yet, they get a message request and can see the post
                after accepting.
              </small>
            </div>

            <textarea
              aria-label="Add a note"
              className="share-post-note"
              maxLength={MAX_NOTE}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a note (optional)"
              rows={2}
              value={note}
            />

            {!canSend && (
              <p className="share-post-hint" role="status">
                {deviceError
                  ? "Chat encryption is not ready on this device."
                  : "Setting up encryption..."}
              </p>
            )}
          </>
        )}

        {results && (
          <ul aria-label="Results" className="share-post-results" role="status">
            {Object.entries(results).map(([key, { name, result }]) => (
              <li className={result.status} key={key}>
                {result.status === SHARE_RESULT.SENT && <FiCheck aria-hidden="true" />}
                <b>{name}</b>
                <span>{resultText(result)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="share-post-actions">
          <div className="share-post-secondary">
            <button onClick={onCopyLink} type="button">
              <FiLink /> Copy link
            </button>
            {onNativeShare && (
              <button onClick={onNativeShare} type="button">
                <FiShare /> More
              </button>
            )}
          </div>

          {results ? (
            <div className="share-post-primary">
              {failedKeys.length > 0 && (
                <button disabled={isSending} onClick={() => send(failedKeys)} type="button">
                  Try again
                </button>
              )}
              <button className="primary" onClick={onClose} type="button">
                Done
              </button>
            </div>
          ) : (
            <button
              className="primary"
              disabled={!canSend || isSending || selectedCount === 0}
              onClick={() => send()}
              type="button"
            >
              {isSending ? "Sending..." : selectedCount > 1 ? `Send to ${selectedCount}` : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>,
  );
}
