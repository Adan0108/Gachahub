"use client";

import { useEffect, useRef } from "react";
import { FiChevronDown, FiChevronUp, FiSearch } from "react-icons/fi";
import { useThreadMessageSearch } from "../../hooks/chat/useThreadMessageSearch";
import { participantUser } from "../../lib/chat/chatDisplay";
import { searchNote } from "../../lib/chat/searchNote";
import { SearchResultRow } from "./SearchResultRow";

const matchesLabel = (count) => `${count} ${count === 1 ? "match" : "matches"}`;

/** Search box and result list for one conversation. Typing does nothing until Enter; Enter again (or Shift+Enter) steps through the results. */
export function ConversationSearchView({ conversation, userId, history, ...searchOptions }) {
  const search = useThreadMessageSearch({ conversation, history, ...searchOptions });
  const { older, results, olderCount } = search;
  const inputRef = useRef(null);

  useEffect(() => inputRef.current?.focus(), []);

  const senderName = (senderId) =>
    senderId === userId ? "You" : participantUser(conversation, senderId)?.name || "GachaHub member";

  const note = searchNote({
    typed: search.typed,
    submitted: search.submitted,
    indexSnapshot: search.indexState,
    resultCount: results.length,
    activePosition: search.activePosition,
  });

  const olderStatus = () => {
    if (history.isWaitingOnRateLimit) return `Slowed down, resuming in ${history.rateLimitSecondsLeft}s...`;
    if (history.historyError) return "Couldn't load older messages.";
    return `Loading older messages... ${olderCount > 0 ? `${matchesLabel(olderCount)} to reach` : ""}`.trim();
  };

  return (
    <div className="chat-info-body chat-search-view">
      <div className="chat-search-box">
        <FiSearch aria-hidden="true" />
        <input
          aria-label="Search this conversation"
          enterKeyHint="search"
          onChange={(event) => search.onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            search.onEnter(event);
          }}
          placeholder="Search in conversation..."
          ref={inputRef}
          type="text"
          value={search.query}
        />
        <button aria-label="Previous result" disabled={results.length === 0} onClick={() => search.step(-1)} type="button">
          <FiChevronUp />
        </button>
        <button aria-label="Next result" disabled={results.length === 0} onClick={() => search.step(1)} type="button">
          <FiChevronDown />
        </button>
      </div>

      {note && (
        <p className="chat-search-note" role="status">
          {note}
        </p>
      )}

      {results.length > 0 && (
        <>
          <ul className={search.isStale ? "chat-search-results stale" : "chat-search-results"}>
            {search.shownResults.map((result, position) => (
              <SearchResultRow
                active={position === search.activePosition}
                key={result.messageId}
                name={senderName(result.senderId)}
                onClick={() => search.goTo(position)}
                result={result}
                terms={search.terms}
              />
            ))}
          </ul>
          {search.hasMoreResults && (
            <div className="chat-search-more">
              <button onClick={search.showMoreResults} type="button">
                Show more results
              </button>
            </div>
          )}
        </>
      )}

      {search.isSearching && history.hasMoreHistory && (
        <div className="chat-search-older">
          {older.isLoading && (older.wants || history.historyError) ? (
            <>
              <small role="status">{olderStatus()}</small>
              <span className="chat-search-older-actions">
                {history.historyError && (
                  <button onClick={history.retryHistory} type="button">
                    Retry
                  </button>
                )}
                <button onClick={older.stop} type="button">
                  Stop
                </button>
              </span>
            </>
          ) : olderCount > 0 ? (
            <>
              <small>{`${matchesLabel(olderCount)} in older messages.`}</small>
              <button onClick={older.start} type="button">
                Show older matches
              </button>
            </>
          ) : (
            <>
              <small>Older messages aren&apos;t searched until they load.</small>
              <button disabled={history.isLoadingOlder} onClick={history.loadOlderMessages} type="button">
                {history.isLoadingOlder ? "Loading..." : "Load older messages"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
