"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";
import { useDebouncedValue } from "../useDebouncedValue";

const TYPING_PAUSE_MS = 150;

/** Members to suggest while someone types `@par`; asks only while `query` is a string, and keeps the last list on screen between keystrokes. */
export function useCommunityMemberSuggestions(slug, query) {
  const typed = useDebouncedValue(query, TYPING_PAUSE_MS);
  const isTyping = typeof query === "string";
  const search = useQuery({
    queryKey: queryKeys.communityMembers(slug, typed ?? ""),
    queryFn: ({ signal }) => api.searchCommunityMembers(slug, typed ?? "", { signal }),
    enabled: isTyping && typeof typed === "string",
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  return { items: isTyping ? (search.data?.items ?? []) : [], isLoading: isTyping && search.isFetching };
}
