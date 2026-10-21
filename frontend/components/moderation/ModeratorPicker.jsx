"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { AvatarFace } from "../AvatarFace";
import { moderatorRoleLabel, moderationKeys } from "../../lib/moderation";

export function ModeratorPicker({
  actorId,
  scopeKey,
  search,
  game,
  onSelect,
  disabled = false,
  granting = false,
  label = "Find moderator",
  initialQuery = "",
}) {
  const [query, setQuery] = useState(initialQuery);
  const normalized = query.trim();
  const settled = useDebouncedValue(normalized, 300);
  const ready = Boolean(settled && settled === normalized);
  const result = useQuery({
    queryKey: [...moderationKeys.account(actorId), "assignees", scopeKey, settled],
    queryFn: ({ signal }) => search(settled, { signal }),
    enabled: ready && !disabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  return (
    <div className="moderator-picker">
      <label>
        {label}
        <input
          type="search"
          aria-label={label}
          autoFocus
          maxLength={100}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="@username or display name"
          disabled={disabled}
        />
      </label>
      <p className="case-muted">
        Use @username for an exact handle match, or 4 or more characters of a display name.
      </p>
      {normalized && (!ready || result.isFetching) && <p role="status">Searching moderators...</p>}
      {ready && result.isError && (
        <p role="alert">
          Could not load moderators.{" "}
          <button type="button" onClick={() => void result.refetch()}>
            Try again
          </button>
        </p>
      )}
      {ready &&
        !result.isFetching &&
        !result.isError &&
        result.data &&
        !result.data.items?.length && <p>No matching moderators.</p>}
      {ready && !result.isError && (
        <ul aria-label="Matching moderators">
          {(result.data?.items || []).map((user) => (
            <li key={user.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(user)}
                aria-label={`Select ${user.name}${user.username ? ` (@${user.username})` : ""}`}
              >
                <span className="case-person-avatar" aria-hidden="true">
                  <AvatarFace name={user.name} image={user.image} />
                </span>
                <span>
                  <b>{user.name}</b>
                  {user.username && <small>@{user.username}</small>}
                  <small className="case-role-badge">
                    {granting && user.role === "USER" ? "User" : moderatorRoleLabel(user, game)}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
