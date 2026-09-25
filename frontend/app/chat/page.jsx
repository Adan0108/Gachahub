"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiArchive,
  FiCheck,
  FiInbox,
  FiLock,
  FiMessageCircle,
  FiDatabase,
  FiMonitor,
  FiPaperclip,
  FiPlus,
  FiSearch,
  FiSend,
  FiShield,
  FiUsers,
  FiX,
} from "react-icons/fi";
import { QueryNotice } from "../../components/QueryNotice";
import { GroupSettingsModal } from "../../components/GroupSettingsModal";
import { SafetyNumberModal } from "../../components/SafetyNumberModal";
import { SafetyBadge, SafetyChangedBanner } from "../../components/SafetyStatus";
import { UserPicker } from "../../components/UserPicker";
import { DevicesModal } from "../../components/DevicesModal";
import { ChatBackupModal } from "../../components/ChatBackupModal";
import { ThreadRow } from "../../components/ThreadRow";
import { AttachmentComposerTray } from "../../components/AttachmentComposerTray";
import { PendingContent } from "../../components/EnvelopeContent";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useAttachmentPicker } from "../../hooks/useAttachmentPicker";
import { useDeviceIdentity } from "../../hooks/useDeviceIdentity";
import { useSyncEngine } from "../../hooks/useSyncEngine";
import { useChatBackup } from "../../hooks/useChatBackup";
import { useThreadData } from "../../hooks/useThreadData";
import { sendEncryptedChatMessage } from "../../lib/mls/messaging/sendEncryptedMessage";
import { sendAttachmentsWithCache } from "../../lib/mls/messaging/sendEncryptedAttachment";
import { pendingStatusLabel } from "../../lib/mls/media/attachmentView";
import { api } from "../../lib/api";
import { queries, queryKeys } from "../../lib/queries";
import {
  activeMembers,
  conversationDisplayName,
  conversationPeer,
  initialOf,
  myParticipant,
  otherActiveMemberIds,
  participantUser,
  relativeTime,
} from "../../lib/chatDisplay";
import { threadItemKey } from "../../lib/chatThread";

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

/** Skeleton shown while the session resolves; mirrors .chat-layout's shape. */
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
  // DM-only; a group's recipients are recomputed per send.
  const peer = conversationPeer(activeConversation, user?.id);
  // A pending group invite can read history; only sending is gated until accept.
  const isPendingGroupInvite =
    activeConversation?.type === "GROUP" &&
    myParticipant(activeConversation, user?.id)?.state === "PENDING";
  const messages = useQuery({
    ...queries.chatMessages(activeId),
    enabled: isAuthenticated && Boolean(activeId),
  });
  const {
    displayMessages,
    isLoadingOlder,
    isWaitingOnRateLimit,
    rateLimitSecondsLeft,
    historyError,
    retryHistory,
    containerRef: messagesContainerRef,
    handleScroll: handleMessagesScroll,
    decrypted: decryptedMessages,
    groupProblem,
    safety,
    safetyPeerIds,
    threadItems,
    readableMessageIds,
    announcement,
  } = useThreadData(activeId, messages.data, activeConversation, user?.id);

  const {
    credential: deviceCredential,
    isReady: isDeviceReady,
    error: deviceError,
    retry: retryDeviceSetup,
    reprovision: reprovisionDevice,
  } = useDeviceIdentity();
  const syncEngine = useSyncEngine();
  const [verifyPeerId, setVerifyPeerId] = useState("");
  const readableMessageIdsKey = readableMessageIds.join(",");
  const messagesEndRef = useRef(null);
  const [draft, setDraft] = useState("");
  // Sent messages awaiting the network, keyed by a client-side id.
  const [pendingMessages, setPendingMessages] = useState([]);
  const attachmentPicker = useAttachmentPicker();
  const fileInputRef = useRef(null);
  // Uploaded attachment entries by clientId, so a retry re-sends without re-uploading.
  const uploadedAttachmentsRef = useRef(new Map());
  const sendMessage = useMutation({
    mutationFn: async ({ text, clientId, files }) => {
      const recipientIds =
        activeConversation?.type === "GROUP"
          ? otherActiveMemberIds(activeConversation, user?.id)
          : peer?.id;
      try {
        if (files?.length) {
          return await sendAttachmentsWithCache({
            syncEngine,
            deviceId: deviceCredential.deviceId,
            conversationId: activeId,
            recipientUserId: recipientIds,
            files,
            caption: text,
            clientMessageId: clientId,
            uploaded: uploadedAttachmentsRef.current,
            onStage: (stage) =>
              setPendingMessages((prev) =>
                prev.map((item) => (item.clientId === clientId ? { ...item, stage } : item)),
              ),
          });
        }
        return await sendEncryptedChatMessage(
          syncEngine,
          deviceCredential.deviceId,
          activeId,
          recipientIds,
          text,
          clientId,
        );
      } catch (error) {
        if (error?.code !== "DEVICE_REVOKED" && error?.code !== "SESSION_NOT_LINKED") throw error;
        // Device retired or unlinked: reprovision for the next attempt, no retry of this send.
        if (!(await reprovisionDevice())) {
          throw new Error("Couldn't reconnect this device. Try again in a moment.", {
            cause: error,
          });
        }
        throw new Error(
          "Your device needed to be reconnected. Give it a few seconds to rejoin your conversations, then try sending again.",
          { cause: error },
        );
      }
    },
    onSuccess: (response, variables) => {
      uploadedAttachmentsRef.current.delete(variables.clientId);
      setPendingMessages((prev) =>
        prev.filter((pending) => pending.clientId !== variables.clientId),
      );
      // Merge the sent message into the cache instead of refetching.
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
    sendMessage.mutate({ text: pending.text, clientId: pending.clientId, files: pending.files });
  };

  const [isComposingNewChat, setIsComposingNewChat] = useState(false);
  const [newChatRecipients, setNewChatRecipients] = useState([]);
  const startNewChat = useMutation({
    mutationFn: () =>
      api.createDirectMessage({
        recipientUserId: newChatRecipients[0]?.id,
        // Placeholder message; SYSTEM type renders it as a "Conversation started" divider.
        message: { ciphertext: "placeholder-pending-mls-setup", contentType: "SYSTEM" },
      }),
    onSuccess: async (result) => {
      await refreshChat();
      setIsComposingNewChat(false);
      setNewChatRecipients([]);
      setView("inbox");
      setSelectedId(result.conversationId);
    },
  });

  useEffect(() => {
    if (!isSessionLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthenticated, isSessionLoading, router]);

  useEffect(() => {
    if (!activeId || !readableMessageIdsKey) return;
    api.markChatDelivered(readableMessageIds).catch(() => {});
    api.markChatRead(activeId, readableMessageIds.at(-1)).catch(() => {});
  }, [activeId, readableMessageIds, readableMessageIdsKey]);

  const decryptedCount = Object.keys(decryptedMessages).length;
  const activePendingCount = pendingMessages.filter(
    (pending) => pending.conversationId === activeId,
  ).length;
  // Follows the latest message, including optimistic bubbles.
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
  const [groupMembers, setGroupMembers] = useState([]);
  const createGroup = useMutation({
    mutationFn: () =>
      api.createGroupChat({
        title: groupTitle.trim(),
        memberUserIds: groupMembers.map((member) => member.id),
      }),
    onSuccess: async (result) => {
      await refreshChat();
      setIsCreatingGroup(false);
      setGroupTitle("");
      setGroupMembers([]);
      setView("inbox");
      setSelectedId(result.id);
    },
  });

  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const groupSettingsButtonRef = useRef(null);
  const [isDevicesOpen, setIsDevicesOpen] = useState(false);
  const devicesButtonRef = useRef(null);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const backupButtonRef = useRef(null);
  // Mounted here (not in the modal) so uploads resume after every reload.
  const backup = useChatBackup(user?.id);

  if (isSessionLoading || !isAuthenticated) {
    return <ChatSkeleton />;
  }

  const actionError = acceptRequest.error || declineRequest.error || blockConversation.error;
  // Only claim end-to-end encryption when this device can actually use the group.
  const encryptionStatus = groupProblem
    ? "Encryption problem on this device"
    : isDeviceReady && syncEngine
      ? "End-to-end encrypted"
      : "Setting up encryption...";
  const shownError =
    actionError || sendMessage.error || (isDeviceReady ? deviceError : undefined);
  const activeConversationName = conversationDisplayName(activeConversation, user?.id);
  const activeGroupMembers = activeMembers(activeConversation);
  const myGroupParticipant = myParticipant(activeConversation, user?.id);
  // Sending is rejected unless ACTIVE (pending, removed, declined, blocked).
  const canSendMessages = myGroupParticipant?.state === "ACTIVE";
  // A group with only PENDING invitees has nobody to encrypt to yet.
  const isGroupAwaitingAcceptance =
    canSendMessages &&
    activeConversation?.type === "GROUP" &&
    otherActiveMemberIds(activeConversation, user?.id).length === 0;

  return (
    <div className="page chat-page">
      <div className="chat-layout">
        <aside className="panel chat-sidebar">
          <div className="chat-sidebar-head">
            <span>Conversations</span>
            <div className="chat-sidebar-tools">
              <button
                aria-label="Your devices"
                title="Your devices"
                onClick={() => setIsDevicesOpen(true)}
                ref={devicesButtonRef}
                type="button"
              >
                <FiMonitor />
              </button>
              <button
                aria-label="Message backup"
                title="Message backup"
                onClick={() => setIsBackupOpen(true)}
                ref={backupButtonRef}
                type="button"
              >
                <FiDatabase />
              </button>
            </div>
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
                if (!newChatRecipients.length || startNewChat.isPending) return;
                startNewChat.mutate();
              }}
            >
              <label htmlFor="new-chat-recipient">Recipient</label>
              <UserPicker
                disabled={startNewChat.isPending}
                id="new-chat-recipient"
                onChange={setNewChatRecipients}
                value={newChatRecipients}
              />
              <button disabled={!newChatRecipients.length || startNewChat.isPending} type="submit">
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
                if (!groupTitle.trim() || !groupMembers.length || createGroup.isPending) {
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
              <label htmlFor="new-group-members">Members</label>
              <UserPicker
                disabled={createGroup.isPending}
                id="new-group-members"
                multiple
                onChange={setGroupMembers}
                value={groupMembers}
              />
              <button
                disabled={!groupTitle.trim() || !groupMembers.length || createGroup.isPending}
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
                  <span className="chat-avatar">{initialOf(activeConversationName)}</span>
                  <span>
                    <b>{activeConversationName}</b>
                    <small>
                      {activeConversation.type === "GROUP" ? (
                        <>
                          <FiLock /> {activeGroupMembers.length} members · {encryptionStatus}
                        </>
                      ) : (
                        <>
                          <FiLock /> {encryptionStatus}
                        </>
                      )}
                    </small>
                  </span>
                </div>
                <div className="chat-thread-actions">
                  {activeConversation.type !== "GROUP" && safetyPeerIds[0] && (
                    <SafetyBadge
                      onVerify={() => setVerifyPeerId(safetyPeerIds[0])}
                      safety={safety.byUser[safetyPeerIds[0]]}
                    />
                  )}
                  {activeConversation.type === "GROUP" && (
                    <button
                      aria-label="Group settings"
                      onClick={() => setIsGroupSettingsOpen(true)}
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

              <div className="sr-only" aria-live="polite" aria-atomic="true">
                <p key={announcement.seq}>{announcement.text}</p>
              </div>
              <div
                className="chat-messages"
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
              >
                <QueryNotice isLoading={messages.isLoading} isError={messages.isError} />
                {groupProblem && (
                  <div className="chat-history-ceiling" role="alert">
                    This group had a problem on this device - messages may not decrypt.
                  </div>
                )}
                <SafetyChangedBanner
                  onVerify={setVerifyPeerId}
                  peers={safetyPeerIds.map((id) => ({
                    id,
                    name: participantUser(activeConversation, id)?.name || "GachaHub member",
                    safety: safety.byUser[id],
                  }))}
                />
                {isWaitingOnRateLimit ? (
                  <div className="chat-history-ceiling">
                    Loading more slowed down - resuming in {rateLimitSecondsLeft}s
                  </div>
                ) : (
                  isLoadingOlder && <div className="chat-history-ceiling">Loading more...</div>
                )}
                {historyError && (
                  <div className="chat-history-ceiling" role="alert">
                    Couldn&apos;t load older messages.
                    <button className="chat-history-retry" onClick={retryHistory} type="button">
                      Retry
                    </button>
                  </div>
                )}
                {threadItems.map((item) => (
                  <ThreadRow
                    allMessages={displayMessages}
                    conversation={activeConversation}
                    decryptedById={decryptedMessages}
                    item={item}
                    key={threadItemKey(item)}
                    userId={user?.id}
                  />
                ))}
                {pendingMessages
                  .filter((pending) => pending.conversationId === activeId)
                  .map((pending) => (
                    <div className="chat-message-row mine" key={pending.clientId}>
                      <article
                        className={`chat-message mine pending ${pending.failed ? "failed" : ""}`}
                      >
                        <div>
                          <PendingContent files={pending.files} text={pending.text} />
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
                              pendingStatusLabel(pending.stage)
                            )}
                          </small>
                        </div>
                      </article>
                    </div>
                  ))}
                {!messages.isLoading &&
                  !messages.isError &&
                  !displayMessages.length &&
                  pendingMessages.length === 0 && (
                    <div className="chat-empty-thread">
                      <FiMessageCircle />
                      <b>No messages in this conversation</b>
                    </div>
                  )}
                <div className="chat-messages-end" ref={messagesEndRef} />
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
              ) : isGroupAwaitingAcceptance ? (
                <div className="chat-composer-disabled">
                  <FiLock />
                  <div>
                    <b>Waiting for someone to accept</b>
                    <small>
                      Nobody has accepted this group invite yet, so messages can&apos;t be encrypted
                      to anyone but you.
                    </small>
                  </div>
                </div>
              ) : isDeviceReady && syncEngine ? (
                <form
                  className="chat-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = draft.trim();
                    const files = attachmentPicker.files;
                    if (!text && files.length === 0) return;
                    const clientId = crypto.randomUUID();
                    // Show the bubble and free the input; the send reconciles in the background.
                    setPendingMessages((prev) => [
                      ...prev,
                      { clientId, text, files, conversationId: activeId },
                    ]);
                    setDraft("");
                    attachmentPicker.clear();
                    sendMessage.mutate({ text, clientId, files });
                  }}
                >
                  <AttachmentComposerTray
                    error={attachmentPicker.error}
                    files={attachmentPicker.files}
                    onRemove={attachmentPicker.remove}
                  />
                  <input
                    hidden
                    multiple
                    onChange={(event) => {
                      attachmentPicker.add([...event.target.files]);
                      event.target.value = "";
                    }}
                    ref={fileInputRef}
                    type="file"
                  />
                  <button
                    aria-label="Attach files"
                    className="chat-attach-button"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <FiPaperclip />
                  </button>
                  <input
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Send an encrypted message..."
                    value={draft}
                  />
                  <button
                    aria-label="Send"
                    disabled={!draft.trim() && attachmentPicker.files.length === 0}
                    type="submit"
                  >
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
              {shownError && <small className="post-action-error">{shownError.message}</small>}
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

      <DevicesModal
        currentDeviceId={deviceCredential?.deviceId}
        isOpen={isDevicesOpen}
        key={isDevicesOpen ? "devices-open" : "devices-closed"}
        onClose={() => setIsDevicesOpen(false)}
        syncEngine={syncEngine}
        triggerRef={devicesButtonRef}
      />

      <ChatBackupModal
        backup={backup}
        isOpen={isBackupOpen}
        key={isBackupOpen ? "backup-open" : "backup-closed"}
        onClose={() => setIsBackupOpen(false)}
        triggerRef={backupButtonRef}
      />

      <GroupSettingsModal
        conversation={activeConversation}
        currentUserId={user?.id}
        isOpen={isGroupSettingsOpen}
        key={isGroupSettingsOpen ? activeId : "group-settings-closed"}
        onClose={() => setIsGroupSettingsOpen(false)}
        onLeft={() => setSelectedId("")}
        onVerify={(userId) => {
          setIsGroupSettingsOpen(false);
          setVerifyPeerId(userId);
        }}
        refreshChat={refreshChat}
        safety={safety.byUser}
        triggerRef={groupSettingsButtonRef}
      />
      <SafetyNumberModal
        hasError={safety.hasError}
        isOpen={Boolean(verifyPeerId)}
        onClose={() => setVerifyPeerId("")}
        onRetry={safety.retry}
        onVerify={() => safety.verify(verifyPeerId)}
        peerName={participantUser(activeConversation, verifyPeerId)?.name || "this person"}
        safety={safety.byUser[verifyPeerId]}
      />
    </div>
  );
}
