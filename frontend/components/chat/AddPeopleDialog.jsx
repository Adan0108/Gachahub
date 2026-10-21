"use client";

import { useRef, useState } from "react";
import { FiCheck, FiSearch, FiX } from "react-icons/fi";
import { floatingPortal } from "../../hooks/chat/useFloatingPosition";
import { useModalFocusTrap } from "../../hooks/chat/useModalFocusTrap";
import { useUserSearch, USER_SEARCH_MIN_CHARS } from "../../hooks/chat/useUserSearch";
import { AvatarFace } from "../AvatarFace";
import "../SharePostDialog.css";
import "./AddPeopleDialog.css";

/** A sheet to pick people for a group: search, tick them, and add them all in one go. */
export function AddPeopleDialog({ excludeIds = [], isPending, error, onAdd, onClose }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]);
  const openerRef = useRef(document.activeElement);
  const modalRef = useModalFocusTrap(true, onClose, openerRef);
  const search = useUserSearch(query);
  const pickedIds = new Set(picked.map((user) => user.id));
  const skipped = new Set(excludeIds);
  const options = search.items.filter((user) => !skipped.has(user.id));
  const typedTooShort = query.trim().length > 0 && !search.isActive;

  const toggle = (user) =>
    setPicked((list) =>
      list.some((item) => item.id === user.id)
        ? list.filter((item) => item.id !== user.id)
        : [...list, { id: user.id, name: user.name, image: user.image, username: user.username }],
    );

  return floatingPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-labelledby="add-people-title"
        aria-modal="true"
        className="modal share-post-modal add-people-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="share-post-head">
          <span aria-hidden="true" />
          <h2 id="add-people-title">Add people</h2>
          <button aria-label="Close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>

        <div className="share-post-search">
          <FiSearch aria-hidden="true" />
          <input
            aria-label="Search people to add"
            autoComplete="off"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or @handle"
            type="search"
            value={query}
          />
        </div>

        <div className="add-people-picked">
          {picked.length === 0 ? (
            <small>No one selected</small>
          ) : (
            <ul aria-label="Selected people">
              {picked.map((user) => (
                <li key={user.id}>
                  <span className="chat-avatar small">
                    <AvatarFace image={user.image} name={user.name} />
                  </span>
                  <span>{user.name}</span>
                  <button aria-label={`Remove ${user.name}`} disabled={isPending} onClick={() => toggle(user)} type="button">
                    <FiX />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div aria-label="Search results" className="add-people-results" role="group">
          {options.map((user) => {
            const isPicked = pickedIds.has(user.id);
            return (
              <button
                aria-checked={isPicked}
                aria-label={user.name}
                className={`add-people-row ${isPicked ? "selected" : ""}`}
                disabled={isPending}
                key={user.id}
                onClick={() => toggle(user)}
                role="checkbox"
                type="button"
              >
                <span className="chat-avatar small">
                  <AvatarFace image={user.image} name={user.name} />
                </span>
                <span className="add-people-name">
                  <b>{user.name}</b>
                  {user.username && <small>@{user.username}</small>}
                </span>
                <span aria-hidden="true" className="add-people-check">
                  {isPicked && <FiCheck />}
                </span>
              </button>
            );
          })}
          {!query.trim() && <p className="share-post-empty">Search by name or @handle to find people.</p>}
          {typedTooShort && (
            <p className="share-post-empty">Type at least {USER_SEARCH_MIN_CHARS} characters to find people.</p>
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
          {search.isActive && !search.isLoading && !search.error && options.length === 0 && (
            <p className="share-post-empty">No one found. Try a name or @handle.</p>
          )}
        </div>

        {error && (
          <small className="add-people-error" role="alert">
            {error.message || "Could not add them."}
          </small>
        )}
        <button
          className="share-post-send add-people-submit"
          disabled={picked.length === 0 || isPending}
          onClick={() => onAdd(picked)}
          type="button"
        >
          {isPending ? "Adding..." : picked.length > 1 ? `Add ${picked.length} people` : "Add people"}
        </button>
      </div>
    </div>,
  );
}
