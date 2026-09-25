"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FiX } from "react-icons/fi";
import { useUserSearch, USER_SEARCH_MIN_CHARS } from "../hooks/useUserSearch";
import { initialOf } from "../lib/chatDisplay";

/**
 * Search-as-you-type user picker. `value` is the list of picked `{ id, name }` users; in single
 * mode picking replaces it and the input hides while someone is picked.
 */
export function UserPicker({
  id,
  value,
  onChange,
  multiple = false,
  disabled = false,
  excludeIds = [],
  placeholder = "Search by name...",
  label = "Search people",
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const search = useUserSearch(query);
  const chipsRef = useRef(null);
  const focusChipAfterPick = useRef(false);
  const pickedIds = new Set([...value.map((user) => user.id), ...excludeIds]);
  const options = search.items.filter((user) => !pickedIds.has(user.id));
  const showInput = multiple || value.length === 0;
  const isOpen = showInput && search.isActive && !disabled;
  const hasResults = isOpen && options.length > 0;
  const activeOption = options[Math.min(activeIndex, options.length - 1)];

  const pick = (user) => {
    const picked = { id: user.id, name: user.name };
    focusChipAfterPick.current = !multiple;
    onChange(multiple ? [...value, picked] : [picked]);
    setQuery("");
    setActiveIndex(0);
  };
  // The input hides after a single pick, so hand focus to the chip's remove button.
  useEffect(() => {
    if (!focusChipAfterPick.current) return;
    focusChipAfterPick.current = false;
    chipsRef.current?.querySelector("button")?.focus();
  }, [value]);
  const remove = (userId) => onChange(value.filter((user) => user.id !== userId));

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + step + options.length) % options.length);
    } else if (event.key === "Enter" && isOpen && activeOption) {
      event.preventDefault();
      pick(activeOption);
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    } else if (event.key === "Backspace" && !query && multiple && value.length) {
      remove(value[value.length - 1].id);
    }
  };

  return (
    <div className="user-picker">
      {value.length > 0 && (
        <ul className="user-picker-chips" ref={chipsRef}>
          {value.map((user) => (
            <li className="user-picker-chip" key={user.id}>
              <span className="chat-avatar small">{initialOf(user.name)}</span>
              <span>{user.name}</span>
              <button
                aria-label={`Remove ${user.name}`}
                disabled={disabled}
                onClick={() => remove(user.id)}
                type="button"
              >
                <FiX />
              </button>
            </li>
          ))}
        </ul>
      )}
      {showInput && (
        <input
          aria-activedescendant={hasResults && activeOption ? `${listId}-${activeOption.id}` : undefined}
          aria-autocomplete="list"
          aria-controls={hasResults ? listId : undefined}
          aria-expanded={hasResults}
          aria-label={label}
          autoComplete="off"
          autoFocus
          disabled={disabled}
          id={id}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          type="text"
          value={query}
        />
      )}
      {showInput && query.trim() && !search.isActive && (
        <small className="user-picker-hint">Type at least {USER_SEARCH_MIN_CHARS} characters.</small>
      )}
      {isOpen && search.isLoading && (
        <div className="user-picker-status" role="status">
          Searching...
        </div>
      )}
      {isOpen && search.error && (
        <div className="user-picker-status error" role="alert">
          Couldn&apos;t search right now.{" "}
          <button onClick={search.retry} type="button">
            Try again
          </button>
        </div>
      )}
      {isOpen && !search.isLoading && !search.error && options.length === 0 && (
        <div className="user-picker-status" role="status">
          No people found.
        </div>
      )}
      {hasResults && (
        <ul className="user-picker-results" id={listId} role="listbox">
          {options.map((user) => (
            <li
              aria-selected={user === activeOption}
              className={user === activeOption ? "active" : ""}
              id={`${listId}-${user.id}`}
              key={user.id}
              onClick={() => pick(user)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
            >
              <span className="chat-avatar small">{initialOf(user.name)}</span>
              <span>{user.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
