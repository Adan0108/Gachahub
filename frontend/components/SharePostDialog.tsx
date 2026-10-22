"use client";

import { useRef } from "react";
import { FiLink, FiSearch, FiSend, FiShare, FiX } from "react-icons/fi";
import { ShareResults } from "./chat/ShareResults";
import { ShareTile } from "./chat/ShareTile";
import { USER_SEARCH_MIN_CHARS } from "../hooks/chat/useUserSearch";
import { useSharePost } from "../hooks/chat/useSharePost";
import { floatingPortal } from "../hooks/chat/useFloatingPosition";
import { useModalFocusTrap } from "../hooks/chat/useModalFocusTrap";
import { useToast } from "../hooks/useToast";
import "./SharePostDialog.css";

const MAX_NOTE = 1000;
const SKELETON_TILES = 8;

/** Sends one post to chats you have and to people you have not messaged yet. Mounted only while open, so the chat engine starts on demand. */
export function SharePostDialog({
  postId,
  onClose,
  onCopyLink,
  onNativeShare,
}: {
  postId: string;
  onClose: () => void;
  onCopyLink?: () => unknown;
  onNativeShare?: () => unknown;
}) {
  const share = useSharePost(postId);
  const {
    canSend,
    deviceError,
    search,
    query,
    tiles,
    picked,
    pickedKeys,
    note,
    isSending,
    send,
    results,
    failedKeys,
  } = share;
  const openerRef = useRef(null);
  const modalRef = useModalFocusTrap(true, onClose, openerRef);
  const { notice, showNotice } = useToast();
  const typedTooShort = query.trim().length > 0 && !search.isActive;

  const copyLink = async () => {
    await onCopyLink?.();
    showNotice("Link copied");
  };

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
                onChange={(event) => share.setQuery(event.target.value)}
                placeholder="Search"
                type="search"
                value={query}
              />
            </div>

            <div aria-label="Send to" className="share-post-grid" role="group">
              {share.isLoadingChats &&
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
                  onToggle={share.toggle}
                  selected={pickedKeys.has(tile.key)}
                  tile={tile}
                />
              ))}
            </div>

            {!share.isLoadingChats && tiles.length === 0 && !search.isLoading && (
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
                  onChange={(event) => share.setNote(event.target.value)}
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
            <ShareResults results={results} />
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
