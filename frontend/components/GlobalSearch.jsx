"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiSearch } from "react-icons/fi";
import { api, fallbackGames, fallbackPosts } from "../lib/api";
import { queries } from "../lib/queries";

function useDebouncedValue(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchInputRef = useRef(null);
  const blurTimerRef = useRef(null);
  const search = query.trim();
  const debouncedSearch = useDebouncedValue(search, 350);
  const canSearch = debouncedSearch.length >= 2;
  const gameSuggestions = useQuery({
    ...queries.games(debouncedSearch),
    enabled: focused && canSearch,
  });
  const canUseLocalSearch = api.usingMocks;
  const suggestedGames = canSearch
    ? (
        gameSuggestions.data?.items ||
        (canUseLocalSearch ? fallbackGames(debouncedSearch).items : [])
      ).slice(0, 3)
    : [];
  const suggestedPosts =
    canSearch && canUseLocalSearch ? fallbackPosts({ search: debouncedSearch }).slice(0, 2) : [];
  const suggestions = [
    ...suggestedGames.map((game) => ({ type: "community", value: game })),
    ...suggestedPosts.map((post) => ({ type: "post", value: post })),
  ];
  const suggestionsOpen = focused && Boolean(search);
  const activeSuggestionId = suggestions[activeSuggestion]
    ? `search-suggestion-${suggestions[activeSuggestion].type}-${suggestions[activeSuggestion].value.id}`
    : undefined;

  const delayCloseSuggestions = () => {
    window.clearTimeout(blurTimerRef.current);
    blurTimerRef.current = window.setTimeout(() => setFocused(false), 120);
  };

  const focusSearch = useCallback(() => {
    window.clearTimeout(blurTimerRef.current);
    setFocused(true);
    searchInputRef.current?.focus();
  }, []);

  const openCommunity = (slug) => {
    setFocused(false);
    setActiveSuggestion(-1);
    router.push(`/community/${encodeURIComponent(slug)}`);
  };

  const openPostSearch = (title) => {
    setFocused(false);
    setActiveSuggestion(-1);
    router.push(`/explore?q=${encodeURIComponent(title)}`);
  };

  const openSuggestion = (suggestion) => {
    if (suggestion.type === "community") openCommunity(suggestion.value.slug);
    else openPostSearch(suggestion.value.title);
  };

  const submit = (event) => {
    event.preventDefault();
    const selectedSuggestion = suggestions[activeSuggestion];
    if (selectedSuggestion) {
      openSuggestion(selectedSuggestion);
      return;
    }

    router.push(search ? `/explore?q=${encodeURIComponent(search)}` : "/explore");
    setFocused(false);
    setActiveSuggestion(-1);
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setFocused(false);
      setActiveSuggestion(-1);
      return;
    }

    if (!suggestions.length || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;

    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    setActiveSuggestion((current) => {
      if (current === -1) return direction === 1 ? 0 : suggestions.length - 1;
      return (current + direction + suggestions.length) % suggestions.length;
    });
  };

  useEffect(() => {
    const handleShortcut = (event) => {
      const isSearchShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      if (!isSearchShortcut) return;
      event.preventDefault();
      focusSearch();
    };

    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.clearTimeout(blurTimerRef.current);
    };
  }, [focusSearch]);

  return (
    <div className="search-wrap">
      <form className="search" onSubmit={submit}>
        <FiSearch />
        <input
          aria-activedescendant={activeSuggestionId}
          aria-autocomplete="list"
          aria-controls="global-search-suggestions"
          aria-expanded={suggestionsOpen}
          aria-label="Search GachaHub"
          aria-keyshortcuts="Control+K Meta+K"
          role="combobox"
          ref={searchInputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setFocused(true);
            setActiveSuggestion(-1);
          }}
          onFocus={focusSearch}
          onBlur={delayCloseSuggestions}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search communities..."
        />
      </form>
      {suggestionsOpen && (
        <div
          className="search-suggestions"
          aria-label="Search suggestions"
          id="global-search-suggestions"
          role="listbox"
        >
          {!canSearch && <div className="search-empty">Enter at least 2 characters.</div>}
          {canSearch && gameSuggestions.isLoading && (
            <div className="search-empty">Searching communities...</div>
          )}
          {canSearch && gameSuggestions.isError && !canUseLocalSearch && (
            <div className="search-empty">
              Search needs the backend. Try again when the API is connected.
            </div>
          )}
          {suggestedGames.map((game, index) => (
            <button
              aria-selected={activeSuggestion === index}
              className={activeSuggestion === index ? "active" : ""}
              id={`search-suggestion-community-${game.id}`}
              key={game.slug}
              role="option"
              tabIndex={-1}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveSuggestion(index)}
              onClick={() => openCommunity(game.slug)}
            >
              <span>{game.symbol}</span>
              <div>
                <b>{game.name}</b>
                <small>{game.members} members</small>
              </div>
            </button>
          ))}
          {suggestedPosts.map((post, index) => {
            const resultIndex = suggestedGames.length + index;
            return (
              <button
                aria-selected={activeSuggestion === resultIndex}
                className={activeSuggestion === resultIndex ? "active" : ""}
                id={`search-suggestion-post-${post.id}`}
                key={post.id}
                role="option"
                tabIndex={-1}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveSuggestion(resultIndex)}
                onClick={() => openPostSearch(post.title)}
              >
                <span>#</span>
                <div>
                  <b>{post.title}</b>
                  <small>{post.gameName}</small>
                </div>
              </button>
            );
          })}
          {canSearch &&
            !gameSuggestions.isLoading &&
            !gameSuggestions.isError &&
            !suggestedGames.length &&
            !suggestedPosts.length && (
              <div className="search-empty">No matches found. Press Enter to search.</div>
            )}
        </div>
      )}
    </div>
  );
}
