"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiArchive,
  FiCheck,
  FiInbox,
  FiLock,
  FiMessageCircle,
  FiPlus,
  FiSearch,
  FiSend,
  FiShield,
  FiX,
} from "react-icons/fi";
import { QueryNotice } from "../../components/QueryNotice";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useDeviceIdentity } from "../../hooks/useDeviceIdentity";
import { useSyncEngine } from "../../hooks/useSyncEngine";
import { useDecryptedMessages } from "../../hooks/useDecryptedMessages";
import { sendEncryptedChatMessage } from "../../lib/mls/messaging/sendEncryptedMessage";
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

function initialOf(name) {
  return name?.trim()?.charAt(0).toUpperCase() || "?";
}

const VIEWS = [
  { key: "inbox", label: "All Chats", icon: FiInbox },
  { key: "requests", label: "Requests", icon: FiShield },
  { key: "archived", label: "Archived", icon: FiArchive },
];

export default function ChatPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoading: isSessionLoading } = useCurrentUser();
  const [view, setView] = useState("inbox");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const conversations = useQuery({ ...queries.chatConversations(), enabled: isAuthenticated });
  const requests = useQuery({ ...queries.chatRequests(), enabled: isAuthenticated });
  const archived = useQuery({
    ...queries.chatArchivedConversations(),
    enabled: isAuthenticated && view === "archived",
  });
  const listByView = { inbox: conversations, requests, archived };
  const listQuery = listByView[view];
  const rawList = listQuery.data || [];
  const searchTerm = search.trim().toLowerCase();
  const currentList = searchTerm
    ? rawList.filter((conversation) =>
        (conversationPeer(conversation, user?.id)?.name || "gachahub member")
          .toLowerCase()
          .includes(searchTerm),
      )
    : rawList;
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

  const { credential: deviceCredential, isReady: isDeviceReady } = useDeviceIdentity();
  const syncEngine = useSyncEngine();
  const decryptedMessages = useDecryptedMessages(activeId, messages.data?.items || [], user?.id);
  const [draft, setDraft] = useState("");
  const sendMessage = useMutation({
    mutationFn: () =>
      sendEncryptedChatMessage(
        syncEngine,
        deviceCredential.deviceId,
        activeId,
        peer?.id,
        draft.trim(),
      ),
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(activeId) });
    },
  });

  const [isComposingNewChat, setIsComposingNewChat] = useState(false);
  const [newChatRecipientId, setNewChatRecipientId] = useState("");
  const startNewChat = useMutation({
    mutationFn: () =>
      api.createDirectMessage({
        recipientUserId: newChatRecipientId.trim(),
        // Placeholder only - a real conversationId doesn't exist until this
        // call creates one, so the actual encrypted MLS group can't be set
        // up until afterward (see sendEncryptedChatMessage's
        // ensureConversationGroup call, which finishes the job on the first
        // real send below). This placeholder message stays permanently
        // undecryptable and shows as "Message unavailable" - a known,
        // accepted rough edge, not a bug.
        message: { ciphertext: "placeholder-pending-mls-setup", contentType: "TEXT" },
      }),
    onSuccess: async (result) => {
      await refreshChat();
      setIsComposingNewChat(false);
      setNewChatRecipientId("");
      setView("inbox");
      setSelectedId(result.conversationId);
    },
  });

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
          <div className="chat-sidebar-head">
            <span>Conversations</span>
            <button
              aria-label="New chat"
              onClick={() => setIsComposingNewChat((current) => !current)}
              type="button"
            >
              <FiPlus /> New Chat
            </button>
          </div>
          {isComposingNewChat && (
            <form
              className="chat-new-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!newChatRecipientId.trim() || startNewChat.isPending) return;
                startNewChat.mutate();
              }}
            >
              <label htmlFor="new-chat-recipient">Recipient user ID</label>
              <input
                autoFocus
                disabled={startNewChat.isPending}
                id="new-chat-recipient"
                onChange={(event) => setNewChatRecipientId(event.target.value)}
                placeholder="Paste their GachaHub user ID..."
                type="text"
                value={newChatRecipientId}
              />
              <button
                disabled={!newChatRecipientId.trim() || startNewChat.isPending}
                type="submit"
              >
                {startNewChat.isPending ? "Starting..." : "Start Chat"}
              </button>
              {startNewChat.error && <small>{startNewChat.error.message}</small>}
            </form>
          )}
          <div className="chat-sidebar-search">
            <FiSearch aria-hidden="true" />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations..."
              type="text"
              value={search}
            />
          </div>
          <div className="chat-tabs" role="tablist" aria-label="Message views">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                aria-selected={view === key}
                className={view === key ? "active" : ""}
                key={key}
                onClick={() => setView(key)}
                role="tab"
                type="button"
              >
                <Icon />
                <span>{label}</span>
                {key !== "archived" && (
                  <b>
                    {key === "inbox"
                      ? conversations.data?.reduce((total, item) => total + item.unreadCount, 0) ||
                        0
                      : requests.data?.length || 0}
                  </b>
                )}
              </button>
            ))}
          </div>
          <QueryNotice
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            isEmpty={!currentList.length}
            emptyText={
              searchTerm
                ? "No conversations match your search."
                : view === "requests"
                  ? "No pending requests."
                  : view === "archived"
                    ? "No archived conversations."
                    : "No conversations yet."
            }
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
                  <span className="chat-avatar">{initialOf(itemPeer?.name)}</span>
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
                  <span className="chat-avatar">{initialOf(peer?.name)}</span>
                  <span>
                    <b>{peer?.name || "GachaHub member"}</b>
                    <small>
                      <FiLock /> End-to-end encrypted
                    </small>
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
                  const decrypted = decryptedMessages[message.id];
                  return (
                    <div className={`chat-message-row ${mine ? "mine" : ""}`} key={message.id}>
                      {!mine && <span className="chat-avatar small">{initialOf(peer?.name)}</span>}
                      <article className={`chat-message ${mine ? "mine" : ""}`}>
                        {decrypted?.status === "ok" ? (
                          <div>
                            <p>
                              {typeof decrypted.envelope.body === "string"
                                ? decrypted.envelope.body
                                : JSON.stringify(decrypted.envelope.body)}
                            </p>
                            <small>{relativeTime(message.createdAt)}</small>
                          </div>
                        ) : decrypted?.status === "unavailable" ? (
                          <>
                            <FiLock aria-hidden="true" />
                            <div>
                              <b>Message unavailable</b>
                              <p>This device can&apos;t decrypt this message.</p>
                              <small>{relativeTime(message.createdAt)}</small>
                            </div>
                          </>
                        ) : (
                          <>
                            <FiLock aria-hidden="true" />
                            <div>
                              <b>Decrypting…</b>
                              <small>{relativeTime(message.createdAt)}</small>
                            </div>
                          </>
                        )}
                      </article>
                    </div>
                  );
                })}
                {!messages.isLoading && !messages.isError && !messages.data?.items?.length && (
                  <div className="chat-empty-thread">
                    <FiMessageCircle />
                    <b>No messages in this conversation</b>
                  </div>
                )}
              </div>

              {isDeviceReady && syncEngine ? (
                <form
                  className="chat-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!draft.trim() || sendMessage.isPending) return;
                    sendMessage.mutate();
                  }}
                >
                  <input
                    disabled={sendMessage.isPending}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Send an encrypted message..."
                    value={draft}
                  />
                  <button
                    aria-label="Send"
                    disabled={!draft.trim() || sendMessage.isPending}
                    type="submit"
                  >
                    <FiSend />
                  </button>
                </form>
              ) : (
                <div className="chat-composer-disabled">
                  <FiLock />
                  <div>
                    <b>Setting up secure messaging</b>
                    <small>This only takes a moment on a new device.</small>
                  </div>
                </div>
              )}
              {(actionError || sendMessage.error) && (
                <small className="post-action-error">
                  {(actionError || sendMessage.error).message}
                </small>
              )}
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
