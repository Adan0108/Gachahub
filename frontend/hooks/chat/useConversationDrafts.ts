"use client";

import { useCallback, useState } from "react";

/**
 * The unsent text of every conversation, kept apart: switching away and back brings it back, and
 * a conversation with nothing typed opens with an empty box. Lives in memory for the session.
 * `setDraft` writes to the open conversation; `setDraftFor` to a specific one.
 */
export function useConversationDrafts(conversationId: string) {
  const [drafts, setDrafts] = useState(() => new Map<string, string>());

  const setDraftFor = useCallback((id: string, text: string) => {
    setDrafts((current) => {
      if ((current.get(id) ?? "") === text) return current;
      const next = new Map(current);
      if (text) next.set(id, text);
      else next.delete(id);
      return next;
    });
  }, []);
  const setDraft = useCallback((text: string) => setDraftFor(conversationId, text), [conversationId, setDraftFor]);

  return { draft: drafts.get(conversationId) ?? "", setDraft, setDraftFor };
}
