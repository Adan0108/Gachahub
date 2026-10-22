"use client";
import type { ChatConversation } from "../../lib/chat/chatDisplay";

import { FiBellOff, FiLock, FiUsers } from "react-icons/fi";
import { useTypingNames } from "../../hooks/chat/useTypingNames";
import {
  activeMembers,
  conversationDisplayName,
  conversationImage,
  conversationMute,
  conversationPeer,
  typingLabel,
} from "../../lib/chat/chatDisplay";
import { compactRelativeTime } from "../../lib/time";
import { usePresenceOf } from "../../hooks/presence/usePresenceOf";
import { AvatarFace } from "../AvatarFace";
import { PresenceDot } from "../PresenceDot";
import { ConversationRowMenu } from "./ConversationRowMenu";

/** One row of the chat list: name, then either who is typing or the last message with how long ago, then the unread count; hovering it offers a menu of actions. */
export function ConversationListItem({
  conversation,
  active,
  userId,
  preview,
  view,
  onSelect,
  onGone,
}: {
  conversation: ChatConversation & {
    unreadCount?: number;
    updatedAt?: string;
    lastMessage?: { createdAt?: string } | null;
  };
  active?: boolean;
  userId?: string;
  preview?: string;
  view?: string;
  onSelect: (id: string) => void;
  onGone?: (id: string) => void;
}) {
  const typingNames = useTypingNames(conversation, userId);
  const peerId = conversation.type === "GROUP" ? undefined : conversationPeer(conversation, userId)?.id;
  const presence = usePresenceOf(peerId);
  const displayName = conversationDisplayName(conversation, userId);
  const isGroup = conversation.type === "GROUP";
  const { isMuted } = conversationMute(conversation, userId);
  const hasUnread = (conversation.unreadCount ?? 0) > 0;
  const sentAt = conversation.lastMessage?.createdAt ?? conversation.updatedAt;

  return (
    <div className={`chat-conversation-row${active ? " active" : ""}`}>
      <button
        className="chat-conversation-open"
        onClick={() => onSelect(conversation.id)}
        type="button"
      >
        <span className="avatar-with-presence">
          <span className="chat-avatar">
            <AvatarFace image={conversationImage(conversation, userId)} name={displayName} />
          </span>
          <PresenceDot status={presence} />
        </span>
        <span>
          <b>{displayName}</b>
          {typingNames.length > 0 ? (
            <small className="chat-list-preview typing">
              <span className="chat-typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {isGroup ? typingLabel(typingNames) : "typing..."}
            </small>
          ) : (
            <small className={`chat-list-preview${hasUnread ? " unread" : ""}`}>
              {preview ? (
                <span className="chat-list-preview-text">{preview}</span>
              ) : isGroup ? (
                <span className="chat-list-preview-text">
                  <FiUsers aria-hidden="true" /> {activeMembers(conversation).length} members
                </span>
              ) : (
                <span className="chat-list-preview-text">
                  <FiLock aria-hidden="true" /> Encrypted message
                </span>
              )}
              <span className="chat-list-preview-time">· {compactRelativeTime(sentAt)}</span>
            </small>
          )}
        </span>
        <span className="chat-list-meta">
          {isMuted && <FiBellOff aria-label="Muted" />}
          {hasUnread && <b className={isMuted ? "muted" : undefined}>{conversation.unreadCount}</b>}
        </span>
      </button>
      <ConversationRowMenu
        conversation={conversation}
        onGone={onGone}
        userId={userId}
        view={view}
      />
    </div>
  );
}
