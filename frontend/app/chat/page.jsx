"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiArchive,
  FiCheck,
  FiInbox,
  FiLock,
  FiLogOut,
  FiMessageCircle,
  FiPlus,
  FiSearch,
  FiSend,
  FiShield,
  FiUsers,
  FiX,
} from "react-icons/fi";
import { QueryNotice } from "../../components/QueryNotice";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useDeviceIdentity } from "../../hooks/useDeviceIdentity";
import { useModalFocusTrap } from "../../hooks/useModalFocusTrap";
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

function activeMembers(conversation) {
  return (conversation?.participants || []).filter((participant) => participant.state === "ACTIVE");
}

/** Active members other than `userId` - who this device's MLS group needs to include. */
function otherActiveMemberIds(conversation, userId) {
  return activeMembers(conversation)
    .filter((participant) => participant.userId !== userId)
    .map((participant) => participant.userId);
}

function participantUser(conversation, userId) {
  return conversation?.participants?.find((participant) => participant.userId === userId)?.user;
}

function myParticipant(conversation, userId) {
  return conversation?.participants?.find((participant) => participant.userId === userId);
}

function conversationDisplayName(conversation, userId) {
  if (conversation?.type === "GROUP") return conversation.title || "Group chat";
  return conversationPeer(conversation, userId)?.name || "GachaHub member";
}

/** Splits a textarea of pasted user IDs (one per line, or comma-separated) into a deduped list. */
function parseUserIds(text) {
  return Array.from(new Set(text.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean)));
}

function initialOf(name) {
  return name?.trim()?.charAt(0).toUpperCase() || "?";
}

/**
 * A message this device can't decrypt, but with both an earlier and a later message it DID
 * decrypt, was very likely sent during a gap in membership (left, or was removed, then came
 * back) rather than a real problem - a genuine decrypt failure has no reason to be bounded on
 * both sides like that. Approximate, since the app doesn't track join/leave history, but a much
 * better message than a generic "can't decrypt" for what's actually expected behavior.
 */
function wasLikelySentDuringAbsence(messages, decryptedMessages, index) {
  const isOk = (message) => decryptedMessages[message?.id]?.status === "ok";
  return messages.slice(0, index).some(isOk) && messages.slice(index + 1).some(isOk);
}

const VIEWS = [
  { key: "inbox", label: "All Chats", icon: FiInbox },
  { key: "requests", label: "Requests", icon: FiShield },
  { key: "archived", label: "Archived", icon: FiArchive },
];

function ChatSkeletonRow() {
  return (
    <div className="chat-skeleton-row">
      <span className="chat-skeleton-avatar" />
      <span className="chat-skeleton-lines">
        <span className="chat-skeleton-bar" />
        <span className="chat-skeleton-bar short" />
      </span>
    </div>
  );
}

/**
 * Shown instead of the real layout while the session is still resolving -
 * mirrors .chat-layout's actual shape (sidebar rows + an empty thread) so
 * the page doesn't visibly restructure once real data replaces it, unlike
 * a generic "Checking your session..." message in an unrelated-looking box.
 */
function ChatSkeleton() {
  return (
    <div className="page chat-page" aria-busy="true" aria-label="Loading conversations">
      <div className="chat-layout">
        <aside className="panel chat-sidebar">
          <div className="chat-skeleton-head">
            <span className="chat-skeleton-bar title" />
            <span className="chat-skeleton-pill" />
          </div>
          <span className="chat-skeleton-bar block" />
          <span className="chat-skeleton-bar block" />
          <div className="chat-skeleton-list">
            {[0, 1, 2, 3, 4].map((index) => (
              <ChatSkeletonRow key={index} />
            ))}
          </div>
        </aside>
        <section className="panel chat-thread" />
      </div>
    </div>
  );
}

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
        conversationDisplayName(conversation, user?.id).toLowerCase().includes(searchTerm),
      )
    : rawList;
  const activeId = currentList.some((conversation) => conversation.id === selectedId)
    ? selectedId
    : currentList[0]?.id || "";
  const activeConversation = currentList.find((conversation) => conversation.id === activeId);
  // DM-only - a group's send recipients are recomputed per-send inside sendMessage below, since
  // they can change between sends (an added member). Declared here, not down by the other
  // derived values after the loading gate, since sendMessage's mutation (which closes over it)
  // is itself declared before that gate too.
  const peer = conversationPeer(activeConversation, user?.id);
  // A pending group invite hides history until accepted (unlike a DM request, which can be
  // previewed) - fetching it 403s, which must not surface as a generic "backend unavailable".
  const isPendingGroupInvite =
    activeConversation?.type === "GROUP" &&
    myParticipant(activeConversation, user?.id)?.state === "PENDING";
  const messages = useQuery({
    ...queries.chatMessages(activeId),
    enabled: isAuthenticated && Boolean(activeId) && !isPendingGroupInvite,
  });
  const messageIds = useMemo(
    () =>
      (messages.data?.items || [])
        .filter((message) => message.senderId !== user?.id)
        .map((message) => message.id),
    [messages.data?.items, user?.id],
  );
  const messageIdsKey = messageIds.join(",");

  const {
    credential: deviceCredential,
    isReady: isDeviceReady,
    error: deviceError,
    retry: retryDeviceSetup,
  } = useDeviceIdentity();
  const syncEngine = useSyncEngine();
  const decryptableMessages = useMemo(
    () => (messages.data?.items || []).filter((message) => message.contentType !== "SYSTEM"),
    [messages.data?.items],
  );
  const decryptedMessages = useDecryptedMessages(activeId, decryptableMessages, user?.id);
  const messagesEndRef = useRef(null);
  const [draft, setDraft] = useState("");
  // Sent messages waiting on the network - shown immediately as their own
  // bubble instead of leaving the composer stuck for however long the send
  // actually takes (MLS encrypt + a real round trip). Keyed by a client-side
  // id since the server hasn't assigned one yet.
  const [pendingMessages, setPendingMessages] = useState([]);
  const sendMessage = useMutation({
    mutationFn: ({ text, clientId }) =>
      sendEncryptedChatMessage(
        syncEngine,
        deviceCredential.deviceId,
        activeId,
        activeConversation?.type === "GROUP"
          ? otherActiveMemberIds(activeConversation, user?.id)
          : peer?.id,
        text,
        clientId,
      ),
    onSuccess: (response, variables) => {
      setPendingMessages((prev) => prev.filter((pending) => pending.clientId !== variables.clientId));
      // Merge the sent message straight into the cache instead of
      // invalidating - a refetch is a second full round trip the sender
      // gains nothing from, since the plaintext is already cached locally
      // from the send itself (see useDecryptedMessages).
      queryClient.setQueryData(queryKeys.chatMessages(activeId), (old) => {
        if (!old || old.items.some((item) => item.id === response.message.id)) {
          return old;
        }
        return { ...old, items: [...old.items, response.message] };
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations });
    },
    onError: (error, variables) => {
      setPendingMessages((prev) =>
        prev.map((pending) =>
          pending.clientId === variables.clientId ? { ...pending, failed: true } : pending,
        ),
      );
    },
  });
  const retryPendingMessage = (pending) => {
    setPendingMessages((prev) =>
      prev.map((item) => (item.clientId === pending.clientId ? { ...item, failed: false } : item)),
    );
    sendMessage.mutate({ text: pending.text, clientId: pending.clientId });
  };

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
        // undecryptable - contentType SYSTEM tells the thread to render it
        // as a "Conversation started" divider instead of a chat bubble, so
        // it never looks like a message someone sent and failed to decrypt.
        message: { ciphertext: "placeholder-pending-mls-setup", contentType: "SYSTEM" },
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

  const decryptedCount = Object.keys(decryptedMessages).length;
  const activePendingCount = pendingMessages.filter(
    (pending) => pending.conversationId === activeId,
  ).length;
  // Follows the latest message - re-runs when the message list grows (a send, or a new one
  // arriving), as messages individually finish decrypting and pop in, and the instant a message
  // is sent (its optimistic bubble), not only once the real round trip confirms it - otherwise
  // sending several messages in quick succession leaves the view stuck above them until the
  // slowest one finally lands.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [activeId, messages.data?.items?.length, decryptedCount, activePendingCount]);

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

  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMemberIdsText, setGroupMemberIdsText] = useState("");
  const createGroup = useMutation({
    mutationFn: () =>
      api.createGroupChat({
        title: groupTitle.trim(),
        memberUserIds: parseUserIds(groupMemberIdsText),
      }),
    onSuccess: async (result) => {
      await refreshChat();
      setIsCreatingGroup(false);
      setGroupTitle("");
      setGroupMemberIdsText("");
      setView("inbox");
      setSelectedId(result.id);
    },
  });

  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const [groupSettingsTitle, setGroupSettingsTitle] = useState("");
  const [groupSettingsPhotoUrl, setGroupSettingsPhotoUrl] = useState("");
  const [addMemberIdsText, setAddMemberIdsText] = useState("");
  const groupSettingsButtonRef = useRef(null);
  const groupSettingsModalRef = useModalFocusTrap(
    isGroupSettingsOpen,
    () => setIsGroupSettingsOpen(false),
    groupSettingsButtonRef,
  );
  const openGroupSettings = () => {
    setGroupSettingsTitle(activeConversation?.title || "");
    setGroupSettingsPhotoUrl(activeConversation?.photoUrl || "");
    setAddMemberIdsText("");
    setIsGroupSettingsOpen(true);
  };
  const updateGroupDetails = useMutation({
    mutationFn: () =>
      api.updateGroupChat(activeId, {
        title: groupSettingsTitle.trim(),
        photoUrl: groupSettingsPhotoUrl.trim() || undefined,
      }),
    onSuccess: refreshChat,
  });
  const addMembers = useMutation({
    mutationFn: () => api.addGroupMembers(activeId, parseUserIds(addMemberIdsText)),
    onSuccess: async () => {
      setAddMemberIdsText("");
      await refreshChat();
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId) => api.removeGroupMembers(activeId, [userId]),
    onSuccess: refreshChat,
  });
  const changeMemberRole = useMutation({
    mutationFn: ({ userId, role }) => api.updateGroupMemberRole(activeId, userId, role),
    onSuccess: refreshChat,
  });
  const transferOwnership = useMutation({
    mutationFn: (userId) => api.transferGroupOwnership(activeId, userId),
    onSuccess: refreshChat,
  });
  const leaveGroup = useMutation({
    mutationFn: () => api.leaveGroup(activeId),
    onSuccess: async () => {
      setIsGroupSettingsOpen(false);
      setSelectedId("");
      await refreshChat();
    },
  });

  if (isSessionLoading || !isAuthenticated) {
    return <ChatSkeleton />;
  }

  const actionError = acceptRequest.error || declineRequest.error || blockConversation.error;
  const activeConversationName = conversationDisplayName(activeConversation, user?.id);
  const activeGroupMembers = activeMembers(activeConversation);
  const myGroupParticipant = myParticipant(activeConversation, user?.id);
  const isGroupOwner = myGroupParticipant?.role === "OWNER";
  const canManageGroup = isGroupOwner || myGroupParticipant?.role === "ADMIN";
  const canLeaveGroup = !isGroupOwner || activeGroupMembers.length <= 1;
  // Not ACTIVE covers a still-pending invite, and being removed/declined/blocked - the backend
  // rejects a send in every one of those states, so the composer shouldn't invite trying at all.
  const canSendMessages = myGroupParticipant?.state === "ACTIVE";

  return (
    <div className="page chat-page">
      <div className="chat-layout">
        <aside className="panel chat-sidebar">
          <div className="chat-sidebar-head">
            <span>Conversations</span>
            <div className="chat-sidebar-actions">
              <button
                aria-label="New chat"
                onClick={() => {
                  setIsComposingNewChat((current) => !current);
                  setIsCreatingGroup(false);
                }}
                type="button"
              >
                <FiPlus /> New Chat
              </button>
              <button
                aria-label="New group"
                onClick={() => {
                  setIsCreatingGroup((current) => !current);
                  setIsComposingNewChat(false);
                }}
                type="button"
              >
                <FiUsers /> New Group
              </button>
            </div>
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
          {isCreatingGroup && (
            <form
              className="chat-new-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!groupTitle.trim() || !groupMemberIdsText.trim() || createGroup.isPending) {
                  return;
                }
                createGroup.mutate();
              }}
            >
              <label htmlFor="new-group-title">Group name</label>
              <input
                autoFocus
                disabled={createGroup.isPending}
                id="new-group-title"
                onChange={(event) => setGroupTitle(event.target.value)}
                placeholder="Team Build Chat"
                type="text"
                value={groupTitle}
              />
              <label htmlFor="new-group-members">Member user IDs</label>
              <textarea
                disabled={createGroup.isPending}
                id="new-group-members"
                onChange={(event) => setGroupMemberIdsText(event.target.value)}
                placeholder="Paste GachaHub user IDs, one per line..."
                value={groupMemberIdsText}
              />
              <button
                disabled={!groupTitle.trim() || !groupMemberIdsText.trim() || createGroup.isPending}
                type="submit"
              >
                {createGroup.isPending ? "Creating..." : "Create Group"}
              </button>
              {createGroup.error && <small>{createGroup.error.message}</small>}
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
              const isGroup = conversation.type === "GROUP";
              const displayName = conversationDisplayName(conversation, user?.id);
              return (
                <button
                  className={activeId === conversation.id ? "active" : ""}
                  key={conversation.id}
                  onClick={() => setSelectedId(conversation.id)}
                  type="button"
                >
                  <span className="chat-avatar">{initialOf(displayName)}</span>
                  <span>
                    <b>{displayName}</b>
                    <small>
                      {isGroup ? (
                        <>
                          <FiUsers /> {activeMembers(conversation).length} members
                        </>
                      ) : (
                        <>
                          <FiLock /> Encrypted message
                        </>
                      )}
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
                  <span className="chat-avatar">
                    {initialOf(activeConversationName)}
                  </span>
                  <span>
                    <b>{activeConversationName}</b>
                    <small>
                      {activeConversation.type === "GROUP" ? (
                        <>
                          <FiLock /> {activeGroupMembers.length} members · End-to-end encrypted
                        </>
                      ) : (
                        <>
                          <FiLock /> End-to-end encrypted
                        </>
                      )}
                    </small>
                  </span>
                </div>
                <div className="chat-thread-actions">
                  {activeConversation.type === "GROUP" && (
                    <button
                      aria-label="Group settings"
                      onClick={openGroupSettings}
                      ref={groupSettingsButtonRef}
                      type="button"
                    >
                      <FiUsers /> Manage
                    </button>
                  )}
                  {view === "requests" && (
                    <>
                      <button
                        className="accept"
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
                    className="danger"
                    disabled={blockConversation.isPending}
                    onClick={() => blockConversation.mutate()}
                    type="button"
                  >
                    <FiShield /> Block
                  </button>
                </div>
              </header>

              <div className="chat-messages" aria-live="polite">
                {isPendingGroupInvite ? (
                  <div className="chat-empty-thread">
                    <FiShield />
                    <b>Accept this invite to see messages</b>
                    <small>Group messages stay hidden until you accept or decline.</small>
                  </div>
                ) : (
                  <>
                    <QueryNotice isLoading={messages.isLoading} isError={messages.isError} />
                    {(messages.data?.items || []).map((message, index, allMessages) => {
                      if (message.contentType === "SYSTEM") {
                        return (
                          <div className="chat-system-message" key={message.id}>
                            <span>Conversation started</span>
                          </div>
                        );
                      }
                      const mine = message.senderId === user?.id;
                      const sender = participantUser(activeConversation, message.senderId);
                      const decrypted = decryptedMessages[message.id];
                      // Not decrypted yet - render nothing rather than a
                      // "Decrypting..." placeholder bubble, so the message pops
                      // in fully formed once it's actually ready instead of
                      // changing content right after appearing.
                      if (!decrypted) {
                        return null;
                      }
                      return (
                        <div className={`chat-message-row ${mine ? "mine" : ""}`} key={message.id}>
                          {!mine && (
                            <span className="chat-avatar small">{initialOf(sender?.name)}</span>
                          )}
                          <article className={`chat-message ${mine ? "mine" : ""}`}>
                            {decrypted.status === "ok" ? (
                              <div>
                                {!mine && activeConversation.type === "GROUP" && (
                                  <small>{sender?.name || "GachaHub member"}</small>
                                )}
                                <p>
                                  {typeof decrypted.envelope.body === "string"
                                    ? decrypted.envelope.body
                                    : JSON.stringify(decrypted.envelope.body)}
                                </p>
                                <small>{relativeTime(message.createdAt)}</small>
                              </div>
                            ) : (
                              <>
                                <FiLock aria-hidden="true" />
                                <div>
                                  <b>Message unavailable</b>
                                  <p>
                                    {wasLikelySentDuringAbsence(allMessages, decryptedMessages, index)
                                      ? "Sent while you weren't in the group."
                                      : "This device can't decrypt this message."}
                                  </p>
                                  <small>{relativeTime(message.createdAt)}</small>
                                </div>
                              </>
                            )}
                          </article>
                        </div>
                      );
                    })}
                    {pendingMessages
                      .filter((pending) => pending.conversationId === activeId)
                      .map((pending) => (
                        <div className="chat-message-row mine" key={pending.clientId}>
                          <article
                            className={`chat-message mine pending ${pending.failed ? "failed" : ""}`}
                          >
                            <div>
                              <p>{pending.text}</p>
                              <small>
                                {pending.failed ? (
                                  <button
                                    className="chat-message-retry"
                                    onClick={() => retryPendingMessage(pending)}
                                    type="button"
                                  >
                                    Failed to send - tap to retry
                                  </button>
                                ) : (
                                  "Sending..."
                                )}
                              </small>
                            </div>
                          </article>
                        </div>
                      ))}
                    {!messages.isLoading &&
                      !messages.isError &&
                      !messages.data?.items?.length &&
                      pendingMessages.length === 0 && (
                        <div className="chat-empty-thread">
                          <FiMessageCircle />
                          <b>No messages in this conversation</b>
                        </div>
                      )}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>

              {!canSendMessages ? (
                <div className="chat-composer-disabled">
                  <FiLock />
                  <div>
                    <b>You can&apos;t send messages here</b>
                    <small>
                      {isPendingGroupInvite
                        ? "Accept the invite to start chatting."
                        : "You are no longer an active participant in this conversation."}
                    </small>
                  </div>
                </div>
              ) : isDeviceReady && syncEngine ? (
                <form
                  className="chat-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = draft.trim();
                    if (!text) return;
                    const clientId = crypto.randomUUID();
                    // Show the bubble and free up the input immediately -
                    // the actual send (MLS encrypt + network) keeps running
                    // in the background and reconciles onSuccess/onError.
                    setPendingMessages((prev) => [
                      ...prev,
                      { clientId, text, conversationId: activeId },
                    ]);
                    setDraft("");
                    sendMessage.mutate({ text, clientId });
                  }}
                >
                  <input
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Send an encrypted message..."
                    value={draft}
                  />
                  <button aria-label="Send" disabled={!draft.trim()} type="submit">
                    <FiSend />
                  </button>
                </form>
              ) : deviceError ? (
                <div className="chat-composer-disabled error">
                  <FiLock />
                  <div>
                    <b>Couldn&apos;t set up secure messaging</b>
                    <small>{deviceError.message}</small>
                  </div>
                  <button onClick={retryDeviceSetup} type="button">
                    Retry
                  </button>
                </div>
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

      {isGroupSettingsOpen && activeConversation && (
        <div className="modal-backdrop" onClick={() => setIsGroupSettingsOpen(false)}>
          <div
            aria-modal="true"
            className="modal group-settings-modal"
            onClick={(event) => event.stopPropagation()}
            ref={groupSettingsModalRef}
            role="dialog"
          >
            <div className="panel-head">
              <h2>Group settings</h2>
              <button
                aria-label="Close group settings"
                onClick={() => setIsGroupSettingsOpen(false)}
                type="button"
              >
                <FiX />
              </button>
            </div>

            {canManageGroup && (
              <form
                className="group-settings-details"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!groupSettingsTitle.trim() || updateGroupDetails.isPending) return;
                  updateGroupDetails.mutate();
                }}
              >
                <label htmlFor="group-settings-title">
                  Group name
                  <input
                    id="group-settings-title"
                    onChange={(event) => setGroupSettingsTitle(event.target.value)}
                    value={groupSettingsTitle}
                  />
                </label>
                <label htmlFor="group-settings-photo">
                  Photo URL
                  <input
                    id="group-settings-photo"
                    onChange={(event) => setGroupSettingsPhotoUrl(event.target.value)}
                    placeholder="https://..."
                    value={groupSettingsPhotoUrl}
                  />
                </label>
                <button
                  className="primary"
                  disabled={!groupSettingsTitle.trim() || updateGroupDetails.isPending}
                  type="submit"
                >
                  {updateGroupDetails.isPending ? "Saving..." : "Save changes"}
                </button>
                {updateGroupDetails.error && <small>{updateGroupDetails.error.message}</small>}
              </form>
            )}

            <div className="group-member-list">
              <h3>Members ({activeGroupMembers.length})</h3>
              {activeConversation.participants
                .filter((participant) => participant.state !== "DECLINED")
                .map((participant) => {
                  const isSelf = participant.userId === user?.id;
                  const canActOnMember = !isSelf && participant.state === "ACTIVE";
                  return (
                    <div className="group-member-row" key={participant.userId}>
                      <span className="chat-avatar small">
                        {initialOf(participant.user?.name)}
                      </span>
                      <span className="group-member-name">
                        <b>
                          {participant.user?.name || "GachaHub member"}
                          {isSelf ? " (You)" : ""}
                        </b>
                        <small>
                          <span className="tag">{participant.role}</span>
                          {participant.state === "PENDING" && <span className="tag">Invited</span>}
                          {participant.state === "LEAVING" && (
                            <span className="tag">Leaving…</span>
                          )}
                        </small>
                      </span>
                      {canActOnMember && (
                        <span className="group-member-actions">
                          {isGroupOwner && participant.role !== "OWNER" && (
                            <>
                              <button
                                disabled={changeMemberRole.isPending}
                                onClick={() =>
                                  changeMemberRole.mutate({
                                    userId: participant.userId,
                                    role: participant.role === "ADMIN" ? "MEMBER" : "ADMIN",
                                  })
                                }
                                type="button"
                              >
                                {participant.role === "ADMIN" ? "Demote" : "Promote"}
                              </button>
                              <button
                                disabled={transferOwnership.isPending}
                                onClick={() => transferOwnership.mutate(participant.userId)}
                                type="button"
                              >
                                Make owner
                              </button>
                            </>
                          )}
                          {canManageGroup && participant.role !== "OWNER" && (
                            <button
                              className="danger"
                              disabled={removeMember.isPending}
                              onClick={() => removeMember.mutate(participant.userId)}
                              type="button"
                            >
                              Remove
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
            {(changeMemberRole.error || transferOwnership.error || removeMember.error) && (
              <small className="post-action-error">
                {(changeMemberRole.error || transferOwnership.error || removeMember.error).message}
              </small>
            )}

            {canManageGroup && (
              <form
                className="chat-new-form group-add-members-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!addMemberIdsText.trim() || addMembers.isPending) return;
                  addMembers.mutate();
                }}
              >
                <label htmlFor="group-add-members">Add members</label>
                <textarea
                  disabled={addMembers.isPending}
                  id="group-add-members"
                  onChange={(event) => setAddMemberIdsText(event.target.value)}
                  placeholder="Paste GachaHub user IDs, one per line..."
                  value={addMemberIdsText}
                />
                <button disabled={!addMemberIdsText.trim() || addMembers.isPending} type="submit">
                  {addMembers.isPending ? "Adding..." : "Add members"}
                </button>
                {addMembers.error && <small>{addMembers.error.message}</small>}
              </form>
            )}

            <div className="group-settings-footer">
              <button
                disabled={!canLeaveGroup || leaveGroup.isPending}
                onClick={() => leaveGroup.mutate()}
                title={canLeaveGroup ? undefined : "Transfer ownership before leaving"}
                type="button"
              >
                <FiLogOut /> Leave group
              </button>
              {leaveGroup.error && <small>{leaveGroup.error.message}</small>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
