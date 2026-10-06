"use client";

import {
  conversationDisplayName,
  conversationImage,
} from "../../lib/chat/chatDisplay";
import { indexingLabel } from "../../lib/chat/messageSearchIndex";
import { buildSnippet } from "../../lib/chat/searchSnippet";
import { AvatarFace } from "../AvatarFace";
import { HighlightedSnippet } from "./HighlightedSnippet";

const MAX_CONVERSATIONS = 20;

/** Sidebar section under the conversation list: which conversations have messages matching the search. */
/** `indexing` is the index snapshot while it is still filling, otherwise null. */
export function MessageSearchResults({ groups, terms, indexing, userId, onSelect }) {
  if (groups.length === 0 && !indexing) return null;

  return (
    <section aria-label="Matching messages" className="chat-message-results">
      <b className="chat-message-results-label">Messages on this device</b>
      {indexing && (
        <small className="chat-message-results-note" role="status">
          {indexingLabel(indexing)}
        </small>
      )}
      {groups.slice(0, MAX_CONVERSATIONS).map(({ conversation, hits }) => {
        const name = conversationDisplayName(conversation, userId);
        return (
          <button
            className="chat-message-result"
            key={conversation.id}
            onClick={() => onSelect(conversation.id, hits[0].messageId)}
            type="button"
          >
            <span className="chat-avatar">
              <AvatarFace image={conversationImage(conversation, userId)} name={name} />
            </span>
            <span className="chat-message-result-text">
              <b>{name}</b>
              <small>
                <HighlightedSnippet snippet={buildSnippet(hits[0].text, terms)} />
              </small>
            </span>
            {hits.length > 1 && <small className="chat-message-result-count">{hits.length} matches</small>}
          </button>
        );
      })}
    </section>
  );
}
