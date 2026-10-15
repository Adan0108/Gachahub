"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import { findLinks, withoutFragment } from "../../lib/chat/linkify";
import { useDebouncedValue } from "../useDebouncedValue";

// Long enough that typing a link out does not ask about every half-written address
const TYPING_PAUSE_MS = 600;
const KEEP_MS = 5 * 60 * 1000;

/** The card for the first link being typed: fetched once typing pauses, removable, and silently absent if the lookup fails. */
export function useLinkPreviewDraft({ text, enabled }) {
  const firstLink = enabled ? findLinks(text)[0] : undefined;
  const link = firstLink ? withoutFragment(firstLink.href) : null;
  const settledLink = useDebouncedValue(link, TYPING_PAUSE_MS);
  const [dismissedLink, setDismissedLink] = useState(null);

  // Starting over with an empty box (after sending, say) forgets what was dismissed; set while rendering so it lands in the same paint.
  if (!link && dismissedLink) setDismissedLink(null);

  const lookup = useQuery({
    queryKey: ["link-preview", settledLink],
    queryFn: () => api.fetchLinkPreview(settledLink),
    enabled: Boolean(settledLink),
    retry: false,
    staleTime: KEEP_MS,
    gcTime: KEEP_MS,
  });

  if (!link || link === dismissedLink) return { preview: null, isLoading: false, dismiss: () => {} };

  const ready = settledLink === link && lookup.data;
  return {
    // The address is the one in the message as the browser writes it, which is what the receiving side checks the card against
    preview: ready ? { ...lookup.data, url: link } : null,
    isLoading: !ready && !lookup.isError && (settledLink !== link || lookup.isFetching),
    dismiss: () => setDismissedLink(link),
  };
}
