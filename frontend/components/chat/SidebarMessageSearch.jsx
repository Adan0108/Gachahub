"use client";

import { useSidebarMessageSearch } from "../../hooks/chat/useSidebarMessageSearch";
import { MessageSearchResults } from "./MessageSearchResults";

/**
 * Message matches for the sidebar's submitted search text. Kept as its own component so the
 * index filling up re-renders only this, not the whole chat page.
 */
export function SidebarMessageSearch({ query, conversations, userId, onSelect }) {
  const { isSearching, indexState, terms, groups } = useSidebarMessageSearch(query, conversations);
  if (!isSearching) return null;

  return (
    <MessageSearchResults
      groups={groups}
      indexing={indexState.status === "ready" ? null : indexState}
      onSelect={onSelect}
      terms={terms}
      userId={userId}
    />
  );
}
