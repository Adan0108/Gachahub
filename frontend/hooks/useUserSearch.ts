"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

export interface UserSearchResult {
  id: string;
  name: string;
  image?: string | null;
}

export const USER_SEARCH_MIN_CHARS = 2;
export const USER_SEARCH_DEBOUNCE_MS = 300;

interface Settled {
  query: string;
  items: UserSearchResult[];
  error?: Error;
}

export interface UserSearch {
  items: UserSearchResult[];
  isLoading: boolean;
  error?: Error;
  /** True once the query is long enough to search. */
  isActive: boolean;
  /** Searches the current query again, e.g. after an error. */
  retry: () => void;
}

/** Debounced user lookup; only the response for the current query is ever shown. */
export function useUserSearch(rawQuery: string): UserSearch {
  const query = rawQuery.trim();
  const isActive = query.length >= USER_SEARCH_MIN_CHARS;
  const [settled, setSettled] = useState<Settled | undefined>();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setSettled(undefined);
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    if (!isActive) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .searchUsers(query, { signal: controller.signal })
        .then((response: { items?: UserSearchResult[] }) => {
          if (!cancelled) setSettled({ query, items: response?.items ?? [] });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setSettled({
            query,
            items: [],
            error: error instanceof Error ? error : new Error("Search failed"),
          });
        });
    }, USER_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isActive, attempt]);

  const current = isActive && settled?.query === query ? settled : undefined;
  return {
    items: current?.items ?? [],
    isLoading: isActive && !current,
    error: current?.error,
    isActive,
    retry,
  };
}
