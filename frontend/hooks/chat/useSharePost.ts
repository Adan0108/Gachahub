"use client";

import { useState } from "react";
import { useChatConversations } from "./useChatConversations";
import { SHARE_RESULT, usePostShare } from "./usePostShare";
import { useUserSearch } from "./useUserSearch";
import { useCurrentUser } from "../useCurrentUser";
import { buildTiles, type ShareTile } from "../../lib/chat/shareTiles";
import type { ShareOutcome } from "./usePostShare";

export type ShareResultEntry = { name: string; image: string | null; result: ShareOutcome };

/** What the share dialog is doing: who is picked, the note, sending one by one, and how each send went. */
export function useSharePost(postId: string) {
  const { user } = useCurrentUser();
  const conversations = useChatConversations();
  const { canSend, deviceError, sendTo } = usePostShare();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ShareTile[]>([]);
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);
  // key -> { name, image, result } once a send has been tried
  const [results, setResults] = useState<Record<string, ShareResultEntry> | null>(null);
  const search = useUserSearch(query);

  const tiles = buildTiles({
    conversations: conversations.data,
    userId: user?.id,
    query,
    found: search.isActive ? search.items : [],
    picked,
  });

  const toggle = (tile: ShareTile) =>
    setPicked((current) =>
      current.some((item) => item.key === tile.key)
        ? current.filter((item) => item.key !== tile.key)
        : [...current, tile],
    );

  const send = async (only?: string[]) => {
    const share = { postId, caption: note };
    const toSend = only ? picked.filter((tile) => only.includes(tile.key)) : picked;
    setIsSending(true);

    // One at a time: each send is a group encryption step on this device.
    for (const tile of toSend) {
      const result = await sendTo(tile, share);
      setResults((current) => ({
        ...(current ?? {}),
        [tile.key]: { name: tile.name, image: tile.image, result },
      }));
    }
    setIsSending(false);
  };

  const failedKeys = results
    ? Object.entries(results)
        .filter(([, entry]) => entry.result.status === SHARE_RESULT.FAILED)
        .map(([key]) => key)
    : [];

  return {
    canSend,
    deviceError,
    isLoadingChats: conversations.isLoading,
    search,
    query,
    setQuery,
    tiles,
    picked,
    pickedKeys: new Set(picked.map((tile) => tile.key)),
    toggle,
    note,
    setNote,
    isSending,
    send,
    results,
    failedKeys,
  };
}
