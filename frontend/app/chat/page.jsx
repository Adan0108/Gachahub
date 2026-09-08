"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiCheck, FiInbox, FiLock, FiMessageCircle, FiShield, FiX } from "react-icons/fi";
import { QueryNotice } from "../../components/QueryNotice";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { api } from "../../lib/api";
import { queries, queryKeys } from "../../lib/queries";

function relativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "Recently";
  const hours = Math.max(1, Math.floor((Date.now() - date.valueOf()) / 3_600_000));
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function conversationPeer(conversation, userId) {
  return conversation?.participants?.find((participant) => participant.userId !== userId)?.user;
}

export default function ChatPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoading: isSessionLoading } = useCurrentUser();
  const [view, setView] = useState("inbox");
  const [selectedId, setSelectedId] = useState("");
  const conversations = useQuery({ ...queries.chatConversations(), enabled: isAuthenticated });
  const requests = useQuery({ ...queries.chatRequests(), enabled: isAuthenticated });
  const currentList = view === "requests" ? requests.data || [] : conversations.data || [];
  const activeId = currentList.some((conversation) => conversation.id === selectedId)
    ? selectedId
    : currentList[0]?.id || "";
  const activeConversation = currentList.find((conversation) => conversation.id === activeId);
  const messages = useQuery({
    ...queries.chatMessages(activeId),
    enabled: isAuthenticated && Boolean(activeId),
  });
  const messageIds = useMemo(
    () =>
      (messages.data?.items || [])
        .filter((message) => message.senderId !== user?.id)
        .map((message) => message.id),
    [messages.data?.items, user?.id],
  );
  const messageIdsKey = messageIds.join(",");

  useEffect(() => {
    if (!isSessionLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthenticated, isSessionLoading, router]);

  useEffect(() => {
    if (!activeId || !messageIdsKey) return;
    api.markChatDelivered(messageIds).catch(() => {});
    api.markChatRead(activeId, messageIds.at(-1)).catch(() => {});
  }, [activeId, messageIds, messageIdsKey]);

  const refreshChat = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations }),
      queryClient.invalidateQueries({ queryKey: queryKeys.chatRequests }),
    ]);
  };

  const acceptRequest = useMutation({
    mutationFn: () => api.acceptChatRequest(activeId),
    onSuccess: async () => {
      await refreshChat();
      setView("inbox");
      setSelectedId(activeId);
    },
  });
  const declineRequest = useMutation({
    mutationFn: () => api.declineChatRequest(activeId),
    onSuccess: async () => {
      setSelectedId("");
      await refreshChat();
    },
  });
  const blockConversation = useMutation({
    mutationFn: () => api.blockChatConversation(activeId),
    onSuccess: async () => {
      setSelectedId("");
      await refreshChat();
    },
  });

  if (isSessionLoading || !isAuthenticated) {
    return (
      <div className="page chat-page">
        <div className="state-card">Checking your session...</div>
      </div>
    );
  }

  const peer = conversationPeer(activeConversation, user?.id);
  const listQuery = view === "requests" ? requests : conversations;
  const actionError = acceptRequest.error || declineRequest.error || blockConversation.error;

  return (
    <div className="page chat-page">
      <section className="welcome hero-polish chat-hero">
        <div>
          <span className="eyebrow">Messages</span>
          <h1>Your conversations</h1>
          <p>Manage conversations and message requests from other GachaHub members.</p>
        </div>
        <FiMessageCircle aria-hidden="true" />
      </section>

      <div className="chat-layout">
        <aside className="panel chat-sidebar">
          <div className="chat-tabs" role="tablist" aria-label="Message views">
            <button
              aria-selected={view === "inbox"}
              className={view === "inbox" ? "active" : ""}
              onClick={() => setView("inbox")}
              role="tab"
              type="button"
            >
              <FiInbox /> Inbox
              <span>
                {conversations.data?.reduce((total, item) => total + item.unreadCount, 0) || 0}
              </span>
            </button>
            <button
              aria-selected={view === "requests"}
              className={view === "requests" ? "active" : ""}
              onClick={() => setView("requests")}
              role="tab"
              type="button"
            >
              <FiShield /> Requests <span>{requests.data?.length || 0}</span>
            </button>
          </div>
          <QueryNotice
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            isEmpty={!currentList.length}
            emptyText={view === "requests" ? "No pending requests." : "No conversations yet."}
          />
          <div className="chat-conversation-list">
            {currentList.map((conversation) => {
              const itemPeer = conversationPeer(conversation, user?.id);
              return (
                <button
                  className={activeId === conversation.id ? "active" : ""}
                  key={conversation.id}
                  onClick={() => setSelectedId(conversation.id)}
                  type="button"
                >
                  <span className="chat-avatar">
                    {itemPeer?.name?.charAt(0).toUpperCase() || "?"}
                  </span>
                  <span>
                    <b>{itemPeer?.name || "GachaHub member"}</b>
                    <small>
                      <FiLock /> Encrypted message
                    </small>
                  </span>
                  <span className="chat-list-meta">
                    <small>{relativeTime(conversation.updatedAt)}</small>
                    {conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="panel chat-thread">
          {activeConversation ? (
            <>
              <header className="chat-thread-head">
                <div>
                  <span className="chat-avatar">{peer?.name?.charAt(0).toUpperCase() || "?"}</span>
                  <span>
                    <b>{peer?.name || "GachaHub member"}</b>
                    <small>End-to-end encrypted payloads</small>
                  </span>
                </div>
                <div className="chat-thread-actions">
                  {view === "requests" && (
                    <>
                      <button
                        disabled={acceptRequest.isPending}
                        onClick={() => acceptRequest.mutate()}
                        type="button"
                      >
                        <FiCheck /> Accept
                      </button>
                      <button
                        disabled={declineRequest.isPending}
                        onClick={() => declineRequest.mutate()}
                        type="button"
                      >
                        <FiX /> Decline
                      </button>
                    </>
                  )}
                  <button
                    disabled={blockConversation.isPending}
                    onClick={() => blockConversation.mutate()}
                    type="button"
                  >
                    <FiShield /> Block
                  </button>
                </div>
              </header>

              <div className="chat-messages" aria-live="polite">
                <QueryNotice isLoading={messages.isLoading} isError={messages.isError} />
                {(messages.data?.items || []).map((message) => {
                  const mine = message.senderId === user?.id;
                  return (
                    <article className={`chat-message ${mine ? "mine" : ""}`} key={message.id}>
                      <FiLock aria-hidden="true" />
                      <div>
                        <b>Encrypted message</b>
                        <p>
                          This client cannot decrypt the payload until secure key exchange is
                          available.
                        </p>
                        <small>{relativeTime(message.createdAt)}</small>
                      </div>
                    </article>
                  );
                })}
                {!messages.isLoading && !messages.isError && !messages.data?.items?.length && (
                  <div className="chat-empty-thread">
                    <FiMessageCircle />
                    <b>No messages in this conversation</b>
                  </div>
                )}
              </div>

              <div className="chat-composer-disabled">
                <FiLock />
                <div>
                  <b>Sending is temporarily unavailable</b>
                  <small>
                    Secure recipient key exchange must be added before this client can encrypt
                    messages.
                  </small>
                </div>
              </div>
              {actionError && <small className="post-action-error">{actionError.message}</small>}
            </>
          ) : (
            <div className="chat-empty-thread">
              <FiMessageCircle />
              <b>Select a conversation</b>
              <small>Your messages or requests will appear here.</small>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
