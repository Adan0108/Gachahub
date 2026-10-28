"use client";

import { useRef, useState } from "react";
import { FiCheck, FiSearch, FiX } from "react-icons/fi";
import { floatingPortal } from "../../hooks/chat/useFloatingPosition";
import { useModalFocusTrap } from "../../hooks/chat/useModalFocusTrap";
import { useUserSearch, USER_SEARCH_MIN_CHARS } from "../../hooks/chat/useUserSearch";
import type { UserSearchResult } from "../../hooks/chat/useUserSearch";
import { AvatarFace } from "../AvatarFace";
import "../SharePostDialog.css";
import "./AddPeopleDialog.css";

/** The count of people still addable only shows once it is this low. */
const ROOM_WARNING_AT = 10;

/** A sheet to pick people: search, tick them, and confirm in one go. Add people, New chat and New group all use it. */
export function AddPeopleDialog({
  title = "Add people",
  searchLabel = "Search people to add",
  submitLabel = (picked) => (picked.length > 1 ? `Add ${picked.length} people` : "Add people"),
  pendingLabel = "Adding...",
  maxPick,
  slots,
  suggested = [],
  nameField,
  excludeIds = [],
  isPending,
  error,
  onSelectionChange,
  onAdd,
  onClose,
}: {
  title?: string;
  searchLabel?: string;
  submitLabel?: (picked: UserSearchResult[]) => string;
  pendingLabel?: string;
  /** 1 makes it a single choice: picking someone else replaces the pick. */
  maxPick?: number;
  /** How many more people may still be added; shown as a count, and no one beyond it can be ticked. */
  slots?: number;
  /** Shown while the search box is empty, so the list never starts blank. */
  suggested?: UserSearchResult[];
  /** Asks for a name too (a new group's); the button waits for it. */
  nameField?: { label: string; placeholder: string; maxLength: number };
  excludeIds?: string[];
  isPending?: boolean;
  error?: Error | null;
  onSelectionChange?: (picked: UserSearchResult[]) => void;
  onAdd: (users: UserSearchResult[], name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<UserSearchResult[]>([]);
  const openerRef = useRef(document.activeElement as HTMLElement | null);
  const modalRef = useModalFocusTrap(true, onClose, openerRef);
  const search = useUserSearch(query);
  const pickedIds = new Set(picked.map((user) => user.id));
  const skipped = new Set(excludeIds);
  const showingSuggestions = !query.trim() && suggested.length > 0;
  const options = (showingSuggestions ? suggested : search.items).filter((user) => !skipped.has(user.id));
  const typedTooShort = query.trim().length > 0 && !search.isActive;
  const single = maxPick === 1;
  const room = slots === undefined ? undefined : Math.max(0, slots - picked.length);
  const roleOfRow = single ? "radio" : "checkbox";

  const toggle = (user: UserSearchResult) => {
    const chosen = { id: user.id, name: user.name, image: user.image, username: user.username };
    const next = picked.some((item) => item.id === user.id)
      ? picked.filter((item) => item.id !== user.id)
      : single
        ? [chosen]
        : [...picked, chosen];
    setPicked(next);
    onSelectionChange?.(next);
  };

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
          <h2 id="add-people-title">{title}</h2>
          <button aria-label="Close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>

        <div className="share-post-search">
          <FiSearch aria-hidden="true" />
          <input
            aria-label={searchLabel}
            autoComplete="off"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or @handle"
            type="search"
            value={query}
          />
        </div>

        {nameField && (
          <input
            aria-label={nameField.label}
            className="add-people-name-input"
            disabled={isPending}
            maxLength={nameField.maxLength}
            onChange={(event) => setName(event.target.value)}
            placeholder={nameField.placeholder}
            type="text"
            value={name}
          />
        )}

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

        {room !== undefined && room <= ROOM_WARNING_AT && (
          <small className="add-people-room">
            {room} {room === 1 ? "person" : "people"} left
          </small>
        )}

        <div aria-label="Search results" className="add-people-results" role={single ? "radiogroup" : "group"}>
          {showingSuggestions && <small className="add-people-heading">Suggested</small>}
          {options.map((user) => {
            const isPicked = pickedIds.has(user.id);
            return (
              <button
                aria-checked={isPicked}
                aria-label={user.name}
                className={`add-people-row ${isPicked ? "selected" : ""}`}
                disabled={isPending || (!isPicked && room === 0 && !single)}
                key={user.id}
                onClick={() => toggle(user)}
                role={roleOfRow}
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
          {!query.trim() && !showingSuggestions && <p className="share-post-empty">Search by name or @handle to find people.</p>}
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
          disabled={picked.length === 0 || isPending || Boolean(nameField && !name.trim())}
          onClick={() => onAdd(picked, name.trim())}
          type="button"
        >
          {isPending ? pendingLabel : submitLabel(picked)}
        </button>
      </div>
    </div>,
  );
}
