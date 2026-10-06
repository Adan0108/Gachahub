"use client";

import { useEffect, useRef, useState } from "react";
import { previewLine, unsentPreview } from "../../lib/chat/conversationPreview";
import { isEditEnvelope } from "../../lib/mls/messaging/editEnvelope";
import {
  EncryptedIndexedDbMessagePlaintextStore,
  onMessageSaved,
} from "../../lib/mls/storage/messagePlaintextStore";

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

/**
 * One-line previews for each conversation's last message, keyed by message id. Only messages this
 * device has already decrypted have one (it reads the local plaintext cache and listens for new
 * saves); nothing is decrypted here, so every other conversation just has no entry yet.
 */
export function useConversationPreviews(conversations, userId) {
  const [previews, setPreviews] = useState({});
  const loadedIds = useRef(new Set());
  // The newest edited preview per message, so a slower read of the original cannot put the old text back.
  const editedLines = useRef(new Map());

  useEffect(() => {
    const lastMessages = (conversations ?? []).map((conversation) => conversation.lastMessage).filter(Boolean);
    const mineById = new Map(lastMessages.map((message) => [message.id, message.senderId === userId]));
    let cancelled = false;

    const remember = (messageId, line) => {
      if (line) setPreviews((current) => ({ ...current, [messageId]: line }));
    };

    for (const message of lastMessages) {
      if (loadedIds.current.has(message.id)) continue;
      loadedIds.current.add(message.id);

      if (message.status === "DELETED") {
        remember(message.id, unsentPreview({ mine: mineById.get(message.id) }));
        continue;
      }

      plaintextStore
        .get(message.id)
        .then((saved) => {
          if (cancelled || !saved) {
            // Not decrypted on this device yet; try again if it shows up in a later pass.
            loadedIds.current.delete(message.id);
            return;
          }
          remember(
            message.id,
            editedLines.current.get(message.id) ?? previewLine(saved.envelope, { mine: mineById.get(message.id) }),
          );
        })
        .catch(() => loadedIds.current.delete(message.id));
    }

    // A message decrypted or sent while the list is showing gets its preview the moment it is saved.
    const stopListening = onMessageSaved((saved) => {
      if (isEditEnvelope(saved.envelope)) {
        const { targetMessageId, text } = saved.envelope.body;
        if (!mineById.has(targetMessageId)) return;
        const line = previewLine({ v: 1, type: "text", body: text }, { mine: mineById.get(targetMessageId) });
        editedLines.current.set(targetMessageId, line);
        remember(targetMessageId, line);
        return;
      }
      if (!mineById.has(saved.messageId)) return;
      remember(saved.messageId, previewLine(saved.envelope, { mine: mineById.get(saved.messageId) }));
    });

    return () => {
      cancelled = true;
      stopListening();
    };
  }, [conversations, userId]);

  return previews;
}
