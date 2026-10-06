"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiArchive,
  FiCheck,
  FiCheckCircle,
  FiEdit2,
  FiInfo,
  FiLock,
  FiMessageCircle,
  FiDatabase,
  FiMonitor,
  FiMoreHorizontal,
  FiPaperclip,
  FiPlus,
  FiSearch,
  FiSend,
  FiShield,
  FiUsers,
  FiX,
} from "react-icons/fi";
import { QueryNotice } from "../../components/QueryNotice";
import { ConversationInfoPanel } from "../../components/chat/ConversationInfoPanel";
import { GroupSettingsModal } from "../../components/chat/GroupSettingsModal";
import { SafetyNumberModal } from "../../components/chat/SafetyNumberModal";
import { SafetyChangedBanner } from "../../components/chat/SafetyStatus";
import { UserPicker } from "../../components/chat/UserPicker";
import { DevicesModal } from "../../components/chat/DevicesModal";
import { ChatBackupModal } from "../../components/chat/ChatBackupModal";
import { RemoveMessageDialog } from "../../components/chat/RemoveMessageDialog";
import { ThreadRow } from "../../components/chat/ThreadRow";
import { ConversationListItem } from "../../components/chat/ConversationListItem";
import { NoChatSelected } from "../../components/chat/NoChatSelected";
import { SidebarMessageSearch } from "../../components/chat/SidebarMessageSearch";
import { JumpToBottomButton } from "../../components/chat/JumpToBottomButton";
import { AttachmentComposerTray } from "../../components/chat/AttachmentComposerTray";
import { LinkPreviewTray } from "../../components/chat/LinkPreviewTray";
import { AttachmentLightbox } from "../../components/chat/AttachmentLightbox";
import { AvatarFace } from "../../components/AvatarFace";
import { PendingContent } from "../../components/chat/EnvelopeContent";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useAttachmentPicker } from "../../hooks/chat/useAttachmentPicker";
import { useDeviceIdentity } from "../../hooks/chat/useDeviceIdentity";
import { useSyncEngine } from "../../hooks/chat/useSyncEngine";
import { useChatBackup } from "../../hooks/chat/useChatBackup";
import { useBackgroundDecrypt } from "../../hooks/chat/useBackgroundDecrypt";
import { useLinkPreviewDraft } from "../../hooks/chat/useLinkPreviewDraft";
import { useConversationActions } from "../../hooks/chat/useConversationActions";
import { useConversationPreviews } from "../../hooks/chat/useConversationPreviews";
import { useMessageEdit } from "../../hooks/chat/useMessageEdit";
import { useMarkChatRead } from "../../hooks/chat/useMarkChatRead";
import { useReadWhenSeen } from "../../hooks/chat/useReadWhenSeen";
import { useReceiptDisplay } from "../../hooks/chat/useReceiptDisplay";
import { useStickToBottom } from "../../hooks/chat/useStickToBottom";
import { useTypingNames } from "../../hooks/chat/useTypingNames";
import { floatingPortal, floatingStyle, useFloatingPosition } from "../../hooks/chat/useFloatingPosition";
import { useMenuDismiss } from "../../hooks/chat/useMenuDismiss";
import { useThreadData } from "../../hooks/chat/useThreadData";
import { sendEncryptedChatMessage, sendEncryptedEdit } from "../../lib/mls/messaging/sendEncryptedMessage";

import { sendAttachmentsWithCache } from "../../lib/mls/messaging/sendEncryptedAttachment";
import { previewForSend } from "../../lib/mls/messaging/sendLinkPreview";
import {
  flattenOtherAttachments,
  flattenVisualAttachments,
  pendingStatusLabel,
} from "../../lib/mls/media/attachmentView";
import { AttachmentLightboxContext } from "../../lib/mls/media/attachmentLightboxContext";
import { api } from "../../lib/api";
import { queries, queryKeys } from "../../lib/queries";
import { typingSignal } from "../../lib/chat/chatTypingSignal";
import { conversationMatches } from "../../lib/chat/conversationSearch";
import { MIN_SEARCH_CHARS, parseSearchQuery } from "../../lib/chat/searchFolding";
import {
  activeMembers,
  conversationDisplayName,
  conversationImage,
  conversationPeer,
  myParticipant,
  otherActiveMemberIds,
  participantUser,
  typingLabel,
} from "../../lib/chat/chatDisplay";
import { threadItemKey, withOptimisticDelete } from "../../lib/chat/chatThread";
import { withOptimisticReaction } from "../../lib/chat/chatReactions";
import { getHiddenMessageIds, hideMessageForMe, unhideMessageForMe } from "../../lib/chat/chatHiddenMessages";

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
        <section className="panel chat-thread">
          <NoChatSelected />
        </section>
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
  // The text message search was last run for (on Enter); null until it has been used.
  const [messageQuery, setMessageQuery] = useState(null);
  const conversations = useQuery({ ...queries.chatConversations(), enabled: isAuthenticated });
  const requests = useQuery({ ...queries.chatRequests(), enabled: isAuthenticated });
  const archived = useQuery({
    ...queries.chatArchivedConversations(),
    enabled: isAuthenticated && view === "archived",
  });
  const listByView = { inbox: conversations, requests, archived };
  const listQuery = listByView[view];
  const rawList = listQuery.data || [];
  const searchTerms = parseSearchQuery(search);
  const isFiltering = searchTerms.length > 0;
  const currentList = isFiltering
    ? rawList.filter((conversation) => conversationMatches(conversation, user?.id, searchTerms))
    : rawList;
  // Nothing is open until you pick a conversation; searching narrows the list but never changes what is open.
  const activeId = rawList.some((conversation) => conversation.id === selectedId) ? selectedId : "";
  const activeConversation = rawList.find((conversation) => conversation.id === activeId);
  // DM-only; a group's recipients are recomputed per send.
  const peer = conversationPeer(activeConversation, user?.id);
  // A pending invite (group invite or DM message request) can read history; only sending is gated until accept.
  const isPendingInvite = myParticipant(activeConversation, user?.id)?.state === "PENDING";
  const messages = useQuery({
    ...queries.chatMessages(activeId),
    enabled: isAuthenticated && Boolean(activeId),
  });
  const typingNames = useTypingNames(activeConversation, user?.id);
  const conversationPreviews = useConversationPreviews(listQuery.data, user?.id);
  useBackgroundDecrypt(listQuery.data, user?.id, activeId);
  const {
    displayMessages,
    isLoadingOlder,
    isWaitingOnRateLimit,
    rateLimitSecondsLeft,
    historyError,
    retryHistory,
    hasMoreHistory,
    loadOlderMessages,
    containerRef: messagesContainerRef,
    handleScroll: handleMessagesScroll,
    decrypted: decryptedMessages,
    edited,
    messagesById,
    neighbors,
    groupProblem,
    safety,
    safetyPeerIds,
    threadItems,
    readableMessageIds,
    announcement,
    now: threadNow,
    patchOlder,
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
  const {
    onScroll: trackMessagesScroll,
    scrollToBottom,
    followIfNearBottom,
    showJumpToBottom,
  } = useStickToBottom(messagesContainerRef);
  const [draft, setDraft] = useState("");
  // { id, senderName, preview } of the message being replied to, or null.
  const [replyTarget, setReplyTarget] = useState(null);
  // Sent messages awaiting the network, keyed by a client-side id.
  const [pendingMessages, setPendingMessages] = useState([]);
  const attachmentPicker = useAttachmentPicker();
  const fileInputRef = useRef(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  // Counts nested dragenter/dragleave pairs as the pointer crosses child elements, so only the
  // outermost dragleave (count back to 0) actually clears the overlay.
  const dragDepthRef = useRef(0);
  // Uploaded attachment entries by clientId, so a retry re-sends without re-uploading.
  const uploadedAttachmentsRef = useRef(new Map());
  // Link preview cards already prepared by clientId, so a retry re-sends the same card without uploading its picture again.
  const preparedPreviewsRef = useRef(new Map());
  const recipientIds = () =>
    activeConversation?.type === "GROUP" ? otherActiveMemberIds(activeConversation, user?.id) : peer?.id;
  // A retired or unlinked device is reprovisioned for the next attempt; this attempt is not retried.
  const withDeviceRecovery = async (action) => {
    try {
      return await action();
    } catch (error) {
      if (error?.code !== "DEVICE_REVOKED" && error?.code !== "SESSION_NOT_LINKED") throw error;
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
  };
  // Merges a message the server just stored into the cache instead of refetching.
  const mergeIntoMessageCache = (conversationId, message) => {
    const hadCachedMessages = Boolean(queryClient.getQueryData(queryKeys.chatMessages(conversationId)));
    queryClient.setQueryData(queryKeys.chatMessages(conversationId), (old) => {
      if (!old || old.items.some((item) => item.id === message.id)) {
        return old;
      }
      return { ...old, items: [...old.items, message] };
    });
    if (!hadCachedMessages) {
      // A brand-new conversation (this group's first-ever message) has no cached page to merge
      // into, so the write above was a silent no-op - fetch it instead of losing the message.
      queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(conversationId) });
    }
  };
  const sendMessage = useMutation({
    mutationFn: ({ text, clientId, files, replyToId, preview }) =>
      withDeviceRecovery(async () => {
        if (files?.length) {
          return sendAttachmentsWithCache({
            syncEngine,
            deviceId: deviceCredential.deviceId,
            conversationId: activeId,
            recipientUserId: recipientIds(),
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
        const card = await previewForSend({
          preview,
          clientMessageId: clientId,
          prepared: preparedPreviewsRef.current,
        });
        return sendEncryptedChatMessage(
          syncEngine,
          deviceCredential.deviceId,
          activeId,
          recipientIds(),
          text,
          clientId,
          replyToId,
          card,
        );
      }),
    onSuccess: (response, variables) => {
      uploadedAttachmentsRef.current.delete(variables.clientId);
      preparedPreviewsRef.current.delete(variables.clientId);
      setPendingMessages((prev) =>
        prev.filter((pending) => pending.clientId !== variables.clientId),
      );
      mergeIntoMessageCache(response.conversationId ?? activeId, response.message);
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
    sendMessage.mutate({
      text: pending.text,
      clientId: pending.clientId,
      files: pending.files,
      preview: pending.preview,
    });
  };

  const composerInputRef = useRef(null);
  const messageEdit = useMessageEdit({
    draft,
    setDraft,
    edited,
    messagesById,
    send: ({ messageId, text, n, clientId }) =>
      withDeviceRecovery(() =>
        sendEncryptedEdit(
          syncEngine,
          deviceCredential.deviceId,
          activeId,
          recipientIds(),
          { targetMessageId: messageId, text, n },
          clientId,
        ),
      ),
    onSent: (response) => mergeIntoMessageCache(response.conversationId ?? activeId, response.message),
    focusInput: () => requestAnimationFrame(() => composerInputRef.current?.focus()),
  });
  // Only a plain text message gets a card: not an attachment, not an edit, and not if the person turned previews off.
  const linkPreview = useLinkPreviewDraft({
    text: draft,
    enabled: user?.sendLinkPreviews !== false && attachmentPicker.files.length === 0 && !messageEdit.target,
  });
  const startEdit = (message) => {
    setReplyTarget(null);
    messageEdit.start(message);
  };

  // Reactions are plaintext metadata, not part of the encrypted envelope. A socket event (handled
  // in useChatSocket) refetches this same query for everyone else once the write lands.
  const refetchMessages = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(activeId) });
  // Patches both the live-window query cache and any older messages already loaded into
  // useConversationHistory's own state - they're never the same array, so an edit on a message
  // you scrolled back to would otherwise silently miss the query cache entirely.
  const patchMessages = async (updater) => {
    const key = queryKeys.chatMessages(activeId);
    await queryClient.cancelQueries({ queryKey: key });
    const previousQueryData = queryClient.getQueryData(key);
    queryClient.setQueryData(key, (old) => (old ? { ...old, items: updater(old.items) } : old));
    const previousOlder = patchOlder(updater);
    return { key, previousQueryData, previousOlder };
  };
  const rollbackOptimisticUpdate = (_error, _variables, context) => {
    if (!context) return;
    queryClient.setQueryData(context.key, context.previousQueryData);
    patchOlder(() => context.previousOlder);
  };
  const reactMutation = useMutation({
    mutationFn: ({ messageId, emoji }) => api.reactToMessage(messageId, emoji),
    onMutate: ({ messageId, emoji }) =>
      patchMessages((items) => withOptimisticReaction(items, messageId, user?.id, emoji)),
    onError: rollbackOptimisticUpdate,
    onSettled: refetchMessages,
  });
  const removeReactionMutation = useMutation({
    mutationFn: ({ messageId }) => api.removeReaction(messageId),
    onMutate: ({ messageId }) =>
      patchMessages((items) => withOptimisticReaction(items, messageId, user?.id, null)),
    onError: rollbackOptimisticUpdate,
    onSettled: refetchMessages,
  });
  const handleReact = (messageId, emoji, mineAlready) =>
    (mineAlready ? removeReactionMutation : reactMutation).mutate({ messageId, emoji });
  const deleteMessageMutation = useMutation({
    mutationFn: (messageId) => api.deleteChatMessage(messageId),
    onMutate: (messageId) => patchMessages((items) => withOptimisticDelete(items, messageId)),
    onError: rollbackOptimisticUpdate,
    onSettled: refetchMessages,
  });
  // The message the remove dialog is asking about: { id, mine }.
  const [removeTarget, setRemoveTarget] = useState(null);
  const handleCopy = (text) => {
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  };

  const [lightboxKey, setLightboxKey] = useState(null);
  const flatAttachments = useMemo(
    () => flattenVisualAttachments(displayMessages, decryptedMessages),
    [displayMessages, decryptedMessages],
  );
  // Same "loaded so far" scope as flatAttachments - the info panel's Media/Files tabs only cover
  // messages already fetched into this window, not the conversation's full history.
  const flatOtherAttachments = useMemo(
    () => flattenOtherAttachments(displayMessages, decryptedMessages),
    [displayMessages, decryptedMessages],
  );
  const lightboxIndex = flatAttachments.findIndex((item) => item.cacheKey === lightboxKey);

  const [isComposingNewChat, setIsComposingNewChat] = useState(false);
  const [newChatRecipients, setNewChatRecipients] = useState([]);
  const [newChatNotice, setNewChatNotice] = useState(null);
  const [acceptedNotice, setAcceptedNotice] = useState(null);
  // Tracks the exact message text dismissed, not just a boolean, so a fresh error (even one that
  // happens to repeat the same text) shows again - cleared on every new send attempt below.
  const [dismissedErrorMessage, setDismissedErrorMessage] = useState(null);
  // Cache is only ever written to by useChatSocket's request:accepted handler.
  const requestAcceptedEvent = useQuery({
    queryKey: queryKeys.chatRequestAccepted(activeId),
    queryFn: () => null,
    enabled: Boolean(activeId),
    staleTime: Infinity,
  }).data;
  // Turns the pushed event into a dismissable notice exactly once, then clears it from the cache
  // so re-selecting this conversation later doesn't replay the same acceptance.
  useEffect(() => {
    if (!requestAcceptedEvent) return undefined;
    const name = participantUser(activeConversation, requestAcceptedEvent.userId)?.name || "They";
    const notice = {
      conversationId: requestAcceptedEvent.conversationId,
      text: `${name} accepted your message request!`,
    };
    queryClient.setQueryData(queryKeys.chatRequestAccepted(requestAcceptedEvent.conversationId), null);
    // Deferred, not called straight from the effect body, so this doesn't fire during React's own
    // commit phase for this render.
    const showTimer = setTimeout(() => setAcceptedNotice(notice), 0);
    const hideTimer = setTimeout(() => setAcceptedNotice(null), 5000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [requestAcceptedEvent, activeConversation, queryClient]);
  const newChatRecipientId = newChatRecipients[0]?.id;
  const newChatFollowStatus = useQuery({
    ...queries.followStatus(newChatRecipientId),
    enabled: isAuthenticated && Boolean(newChatRecipientId),
  });
  // Anything short of a mutual follow becomes a pending message request, not an active chat.
  const newChatWillBeRequest = Boolean(
    newChatRecipientId &&
      newChatFollowStatus.data &&
      !(newChatFollowStatus.data.following && newChatFollowStatus.data.followsMe),
  );
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
      setNewChatNotice(
        result.recipientState === "PENDING"
          ? {
              conversationId: result.conversationId,
              text: `Message request sent to ${newChatRecipients[0]?.name || "them"}. They'll need to accept it before you can chat.`,
            }
          : null,
      );
      setNewChatRecipients([]);
      setView("inbox");
      setSelectedId(result.conversationId);
    },
  });

  useEffect(() => {
    if (!isSessionLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthenticated, isSessionLoading, router]);

  // This device has the messages as soon as they are decrypted; they only count as read once they are on screen.
  useEffect(() => {
    if (!activeId || !readableMessageIdsKey) return;
    api.markChatDelivered(readableMessageIds).catch(() => {});
  }, [activeId, readableMessageIds, readableMessageIdsKey]);
  const markChatRead = useMarkChatRead();
  useReadWhenSeen({
    containerRef: messagesContainerRef,
    conversationId: activeId,
    messageIds: readableMessageIds,
    onRead: (messageId) => markChatRead(activeId, messageId, { isNewest: messageId === readableMessageIds.at(-1) }),
  });

  const [replyLightboxOwnerId, setReplyLightboxOwnerId] = useState(activeId);
  const [hiddenMessageIds, setHiddenMessageIds] = useState(() => getHiddenMessageIds(activeId));
  const [hiddenNotice, setHiddenNotice] = useState(null);
  // None of these carry over to a different conversation - reset during render, not an effect,
  // so it lands in the same paint instead of flashing the stale value first.
  if (activeId !== replyLightboxOwnerId) {
    typingSignal.stop(replyLightboxOwnerId);
    setReplyLightboxOwnerId(activeId);
    setReplyTarget(null);
    if (messageEdit.target) messageEdit.leave();
    setRemoveTarget(null);
    setLightboxKey(null);
    setHiddenMessageIds(getHiddenMessageIds(activeId));
    setHiddenNotice(null);
  }
  const hideMessage = (messageId) => {
    hideMessageForMe(activeId, messageId);
    setHiddenMessageIds((current) => new Set(current).add(messageId));
    setHiddenNotice({ conversationId: activeId, messageId });
  };
  const confirmRemove = (scope) => {
    const { id } = removeTarget;
    setRemoveTarget(null);
    if (scope === "everyone") deleteMessageMutation.mutate(id);
    else hideMessage(id);
  };
  const undoDeleteForMe = () => {
    if (!hiddenNotice) return;
    unhideMessageForMe(hiddenNotice.conversationId, hiddenNotice.messageId);
    if (hiddenNotice.conversationId === activeId) {
      setHiddenMessageIds((current) => {
        const next = new Set(current);
        next.delete(hiddenNotice.messageId);
        return next;
      });
    }
    setHiddenNotice(null);
  };
  const jumpToMessage = (messageId) => {
    const row = document.getElementById(`chat-message-${messageId}`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("jump-highlight");
    setTimeout(() => row.classList.remove("jump-highlight"), 1200);
  };

  const decryptedCount = Object.keys(decryptedMessages).length;
  const activePendingCount = pendingMessages.filter(
    (pending) => pending.conversationId === activeId,
  ).length;
  const receiptInfo = useReceiptDisplay({
    messages: displayMessages,
    hiddenMessageIds,
    userId: user?.id,
    conversation: activeConversation,
    peerId: peer?.id,
    hasPending: activePendingCount > 0,
  });
  const someoneTyping = typingNames.length > 0;
  const previousPendingCount = useRef(0);
  // Opening a conversation starts at its newest message.
  useEffect(() => {
    scrollToBottom();
  }, [activeId, scrollToBottom]);
  // Reaction chips and "Edited" labels make the thread taller without adding a message.
  const reactionCount = displayMessages.reduce((total, message) => total + (message.reactions?.length ?? 0), 0);
  const editLabelCount = edited.size + messageEdit.pending.size;
  // New messages, reactions, edits and the typing indicator only follow you while you're already at the bottom.
  useEffect(() => {
    followIfNearBottom();
  }, [messages.data?.items?.length, decryptedCount, someoneTyping, reactionCount, editLabelCount, followIfNearBottom]);
  // Sending a message always takes you to it, wherever you were.
  useEffect(() => {
    if (activePendingCount > previousPendingCount.current) scrollToBottom();
    previousPendingCount.current = activePendingCount;
  }, [activePendingCount, scrollToBottom]);

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
  // A chat that was blocked, archived or deleted is no longer in this list, so it cannot stay open.
  const closeIfOpen = (conversationId) => {
    if (conversationId === activeId) setSelectedId("");
  };
  const conversationActions = useConversationActions({ onGone: closeIfOpen });

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

  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuButtonRef = useRef(null);
  const moreMenuRef = useRef(null);
  useMenuDismiss(isMoreMenuOpen, () => setIsMoreMenuOpen(false), moreMenuButtonRef, moreMenuRef);
  const moreMenuStyle = useFloatingPosition(isMoreMenuOpen, moreMenuButtonRef, moreMenuRef);

  const [isComposeMenuOpen, setIsComposeMenuOpen] = useState(false);
  const composeMenuButtonRef = useRef(null);
  const composeMenuRef = useRef(null);
  useMenuDismiss(
    isComposeMenuOpen,
    () => setIsComposeMenuOpen(false),
    composeMenuButtonRef,
    composeMenuRef,
  );
  const composeMenuStyle = useFloatingPosition(isComposeMenuOpen, composeMenuButtonRef, composeMenuRef);

  const [isConversationInfoOpen, setIsConversationInfoOpen] = useState(false);
  // A message search started from the sidebar: opens that conversation's search panel with the same text.
  const [searchSeed, setSearchSeed] = useState(null);
  const selectConversation = (conversationId) => {
    setSelectedId(conversationId);
    setSearchSeed(null);
  };
  const openMessageSearch = (conversationId, messageId) => {
    setSelectedId(conversationId);
    setSearchSeed({ conversationId, messageId, query: messageQuery ?? "", nonce: Date.now() });
    setIsConversationInfoOpen(true);
  };

  if (isSessionLoading || !isAuthenticated) {
    return <ChatSkeleton />;
  }

  const actionError = acceptRequest.error || declineRequest.error || conversationActions.block.error;
  // Only claim end-to-end encryption when this device can actually use the group.
  const encryptionStatus = groupProblem
    ? "Encryption problem on this device"
    : isDeviceReady && syncEngine
      ? "End-to-end encrypted"
      : "Setting up encryption...";
  const shownError =
    actionError || sendMessage.error || (isDeviceReady ? deviceError : undefined);
  // Verifying a safety number is only meaningful for a specific peer, so it's DM-only here too.
  const verifyPeerCandidate = safetyPeerIds[0];
  const verifyPeerSafety = safety.byUser[verifyPeerCandidate];
  const canVerify =
    Boolean(activeConversation) &&
    activeConversation.type !== "GROUP" &&
    Boolean(verifyPeerCandidate) &&
    Boolean(verifyPeerSafety?.pairNumber);
  const verifyLabel =
    verifyPeerSafety?.status === "verified"
      ? "Verified"
      : verifyPeerSafety?.status === "new-device"
        ? "New device"
        : "Verify end-to-end encryption";
  const activeConversationName = conversationDisplayName(activeConversation, user?.id);
  const activeConversationImage = conversationImage(activeConversation, user?.id);
  const activeGroupMembers = activeMembers(activeConversation);
  const myGroupParticipant = myParticipant(activeConversation, user?.id);
  // Sending is rejected unless ACTIVE (pending, removed, declined, blocked).
  const canSendMessages = myGroupParticipant?.state === "ACTIVE";
  // A group with only PENDING invitees has nobody to encrypt to yet.
  const isGroupAwaitingAcceptance =
    canSendMessages &&
    activeConversation?.type === "GROUP" &&
    otherActiveMemberIds(activeConversation, user?.id).length === 0;
  const composerReady =
    canSendMessages && !isGroupAwaitingAcceptance && isDeviceReady && Boolean(syncEngine);

  const handleThreadDragEnter = (event) => {
    if (!composerReady || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  };
  const handleThreadDragOver = (event) => {
    if (!composerReady || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
  };
  const handleThreadDragLeave = (event) => {
    if (!composerReady || !event.dataTransfer?.types?.includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFile(false);
  };
  const handleThreadDrop = (event) => {
    if (!composerReady || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);
    attachmentPicker.add([...event.dataTransfer.files]);
  };
  const handleDraftPaste = (event) => {
    const items = [...(event.clipboardData?.items || [])];
    const imageFiles = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length === 0) return;
    event.preventDefault();
    attachmentPicker.add(imageFiles);
  };

  return (
    <div className="page chat-page">
      <div className={`chat-layout ${isConversationInfoOpen && activeConversation ? "info-open" : ""}`}>
        <aside className="panel chat-sidebar">
          <div className="chat-sidebar-head">
            <span>Conversations</span>
            <div className="chat-sidebar-tools">
              <div className="chat-menu-wrap">
                <button
                  aria-expanded={isMoreMenuOpen}
                  aria-haspopup="menu"
                  aria-label="More"
                  className="chat-icon-button"
                  onClick={() => setIsMoreMenuOpen((current) => !current)}
                  ref={moreMenuButtonRef}
                  title="More"
                  type="button"
                >
                  <FiMoreHorizontal />
                </button>
                {isMoreMenuOpen &&
                  floatingPortal(
                    <div
                      className="chat-menu"
                      ref={moreMenuRef}
                      role="menu"
                      style={floatingStyle(moreMenuStyle)}
                    >
                      <button
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsDevicesOpen(true);
                        }}
                        ref={devicesButtonRef}
                        role="menuitem"
                        type="button"
                      >
                        <FiMonitor /> Your devices
                      </button>
                      <button
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsBackupOpen(true);
                        }}
                        ref={backupButtonRef}
                        role="menuitem"
                        type="button"
                      >
                        <FiDatabase /> Backup
                      </button>
                      <button
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setView((current) => (current === "requests" ? "inbox" : "requests"));
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <FiShield /> Requests
                        {requests.data?.length > 0 && <b>{requests.data.length}</b>}
                      </button>
                      <button
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setView((current) => (current === "archived" ? "inbox" : "archived"));
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <FiArchive /> Archived
                      </button>
                    </div>,
                  )}
              </div>
              <div className="chat-menu-wrap">
                <button
                  aria-expanded={isComposeMenuOpen}
                  aria-haspopup="menu"
                  aria-label="New conversation"
                  className="chat-icon-button"
                  onClick={() => setIsComposeMenuOpen((current) => !current)}
                  ref={composeMenuButtonRef}
                  title="New conversation"
                  type="button"
                >
                  <FiEdit2 />
                </button>
                {isComposeMenuOpen &&
                  floatingPortal(
                    <div
                      className="chat-menu"
                      ref={composeMenuRef}
                      role="menu"
                      style={floatingStyle(composeMenuStyle)}
                    >
                      <button
                        onClick={() => {
                          setIsComposeMenuOpen(false);
                          setIsComposingNewChat(true);
                          setIsCreatingGroup(false);
                          setNewChatNotice(null);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <FiPlus /> New Chat
                      </button>
                      <button
                        onClick={() => {
                          setIsComposeMenuOpen(false);
                          setIsCreatingGroup(true);
                          setIsComposingNewChat(false);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <FiUsers /> New Group
                      </button>
                    </div>,
                  )}
              </div>
            </div>
          </div>
          {view !== "inbox" && (
            <div className="chat-view-banner">
              <span>{view === "requests" ? "Requests" : "Archived"}</span>
              <button onClick={() => setView("inbox")} type="button">
                <FiX /> All chats
              </button>
            </div>
          )}
          {isComposingNewChat && (
            <form
              className="chat-new-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!newChatRecipients.length || startNewChat.isPending) return;
                startNewChat.mutate();
              }}
            >
              <div className="chat-new-form-head">
                <b>New Chat</b>
                <button
                  aria-label="Cancel"
                  onClick={() => setIsComposingNewChat(false)}
                  type="button"
                >
                  <FiX />
                </button>
              </div>
              <label htmlFor="new-chat-recipient">Recipient</label>
              <UserPicker
                currentUser={user}
                disabled={startNewChat.isPending}
                id="new-chat-recipient"
                onChange={setNewChatRecipients}
                value={newChatRecipients}
              />
              <button disabled={!newChatRecipients.length || startNewChat.isPending} type="submit">
                {startNewChat.isPending
                  ? "Sending..."
                  : newChatWillBeRequest
                    ? "Send Message Request"
                    : "Start Chat"}
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
              <div className="chat-new-form-head">
                <b>New Group</b>
                <button aria-label="Cancel" onClick={() => setIsCreatingGroup(false)} type="button">
                  <FiX />
                </button>
              </div>
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
                currentUser={user}
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
              enterKeyHint="search"
              onChange={(event) => {
                setSearch(event.target.value);
                if (!event.target.value.trim()) setMessageQuery((current) => (current === null ? null : ""));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && search.trim().length >= MIN_SEARCH_CHARS) setMessageQuery(search.trim());
              }}
              placeholder="Search chats and messages..."
              type="text"
              value={search}
            />
          </div>
          {search.trim().length >= MIN_SEARCH_CHARS && search.trim() !== messageQuery && (
            <small className="chat-sidebar-search-hint">Press Enter to search messages</small>
          )}
          <QueryNotice
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            isEmpty={!currentList.length}
            emptyText={
              isFiltering
                ? "No conversations match your search."
                : view === "requests"
                  ? "No pending requests."
                  : view === "archived"
                    ? "No archived conversations."
                    : "No conversations yet."
            }
          />
          <div className="chat-conversation-list">
            {currentList.map((conversation) => (
              <ConversationListItem
                active={activeId === conversation.id}
                conversation={conversation}
                key={conversation.id}
                onGone={closeIfOpen}
                onSelect={selectConversation}
                preview={conversationPreviews[conversation.lastMessage?.id]}
                userId={user?.id}
                view={view}
              />
            ))}
          </div>
          {messageQuery !== null && (
            <SidebarMessageSearch
              conversations={listQuery.data}
              onSelect={openMessageSearch}
              query={messageQuery}
              userId={user?.id}
            />
          )}
        </aside>

        <section
          className="panel chat-thread"
          onDragEnter={handleThreadDragEnter}
          onDragLeave={handleThreadDragLeave}
          onDragOver={handleThreadDragOver}
          onDrop={handleThreadDrop}
        >
          {isDraggingFile && (
            <div className="chat-dropzone-overlay">
              <FiPaperclip />
              <span>Drop to attach</span>
            </div>
          )}
          {activeConversation ? (
            <>
              <header className="chat-thread-head">
                <div>
                  <span className="chat-avatar">
                    <AvatarFace image={activeConversationImage} name={activeConversationName} />
                  </span>
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
                    aria-expanded={isConversationInfoOpen}
                    aria-label="Conversation info"
                    className="chat-icon-button"
                    onClick={() => setIsConversationInfoOpen((current) => !current)}
                    title="Conversation info"
                    type="button"
                  >
                    <FiInfo />
                  </button>
                </div>
              </header>

              <div className="sr-only" aria-live="polite" aria-atomic="true">
                <p key={announcement.seq}>{announcement.text}</p>
              </div>
              <div className="chat-messages-wrap">
              <div
                className="chat-messages"
                ref={messagesContainerRef}
                onScroll={(event) => {
                  trackMessagesScroll(event);
                  handleMessagesScroll(event);
                }}
              >
                <AttachmentLightboxContext.Provider value={setLightboxKey}>
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
                {threadItems
                  .filter((item) => item.kind !== "message" || !hiddenMessageIds.has(item.message.id))
                  .map((item) => (
                    <ThreadRow
                      conversation={activeConversation}
                      decryptedById={decryptedMessages}
                      edited={edited}
                      item={item}
                      onDiscardEdit={messageEdit.discard}
                      onRetryEdit={messageEdit.retry}
                      pendingEdits={messageEdit.pending}
                      receiptInfo={receiptInfo}
                      key={threadItemKey(item)}
                      messagesById={messagesById}
                      neighbors={neighbors}
                      now={threadNow}
                      onCopy={handleCopy}
                      onRemove={setRemoveTarget}
                      onEdit={startEdit}
                      onJumpToMessage={jumpToMessage}
                      onReact={handleReact}
                      onReply={setReplyTarget}
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
                          <PendingContent files={pending.files} preview={pending.preview} text={pending.text} />
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
                {typingNames.length > 0 && (
                  <div className="chat-typing-indicator">
                    <span className="chat-typing-pill">
                      <span className="chat-typing-dots">
                        <span />
                        <span />
                        <span />
                      </span>
                      {typingLabel(typingNames)}
                    </span>
                  </div>
                )}
                </AttachmentLightboxContext.Provider>
              </div>
              <JumpToBottomButton onClick={() => scrollToBottom("smooth")} visible={showJumpToBottom} />
              </div>
              {lightboxIndex >= 0 && (
                <AttachmentLightbox
                  index={lightboxIndex}
                  items={flatAttachments}
                  onClose={() => setLightboxKey(null)}
                  onNavigate={(delta) =>
                    setLightboxKey(
                      flatAttachments[lightboxIndex + delta]?.cacheKey ?? lightboxKey,
                    )
                  }
                />
              )}

              {newChatNotice && newChatNotice.conversationId === activeId && (
                <div className="chat-new-chat-notice">
                  <small>{newChatNotice.text}</small>
                  <button aria-label="Dismiss" onClick={() => setNewChatNotice(null)} type="button">
                    <FiX />
                  </button>
                </div>
              )}
              {acceptedNotice && acceptedNotice.conversationId === activeId && (
                <div className="chat-new-chat-notice chat-request-accepted-notice">
                  <FiCheckCircle aria-hidden="true" />
                  <small>{acceptedNotice.text}</small>
                  <button aria-label="Dismiss" onClick={() => setAcceptedNotice(null)} type="button">
                    <FiX />
                  </button>
                </div>
              )}
              {hiddenNotice && hiddenNotice.conversationId === activeId && (
                <div className="chat-new-chat-notice">
                  <small>Message hidden on this device.</small>
                  <button className="chat-new-chat-notice-action" onClick={undoDeleteForMe} type="button">
                    Undo
                  </button>
                  <button aria-label="Dismiss" onClick={() => setHiddenNotice(null)} type="button">
                    <FiX />
                  </button>
                </div>
              )}
              {shownError && shownError.message !== dismissedErrorMessage && (
                <div className="chat-composer-error">
                  <span>{shownError.message}</span>
                  <button
                    aria-label="Dismiss"
                    onClick={() => setDismissedErrorMessage(shownError.message)}
                    type="button"
                  >
                    <FiX />
                  </button>
                </div>
              )}
              {!canSendMessages ? (
                <div className="chat-composer-disabled">
                  <FiLock />
                  <div>
                    <b>You can&apos;t send messages here</b>
                    <small>
                      {isPendingInvite
                        ? activeConversation?.type === "GROUP"
                          ? "Accept the invite to start chatting."
                          : "You haven't accepted this message request yet."
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
                <>
                  {replyTarget && (
                    <div className="chat-reply-banner">
                      <small>
                        Replying to <b>{replyTarget.senderName}</b>: {replyTarget.preview}
                      </small>
                      <button
                        aria-label="Cancel reply"
                        onClick={() => setReplyTarget(null)}
                        type="button"
                      >
                        <FiX />
                      </button>
                    </div>
                  )}
                  {messageEdit.target && (
                    <div className="chat-reply-banner chat-edit-banner">
                      <small>
                        <b>Editing message</b>
                        {messageEdit.error && (
                          <span className="chat-edit-error" role="alert">
                            {" "}
                            {messageEdit.error}
                          </span>
                        )}
                      </small>
                      <button aria-label="Cancel edit" onClick={messageEdit.leave} type="button">
                        <FiX />
                      </button>
                    </div>
                  )}
                  <form
                    className="chat-composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (messageEdit.target) return messageEdit.submit();
                      const text = draft.trim();
                      const files = attachmentPicker.files;
                      if (!text && files.length === 0) return;
                      const clientId = crypto.randomUUID();
                      const preview = files.length === 0 ? (linkPreview.preview ?? undefined) : undefined;
                      // Show the bubble and free the input; the send reconciles in the background.
                      setPendingMessages((prev) => [
                        ...prev,
                        { clientId, text, files, preview, conversationId: activeId },
                      ]);
                      setDraft("");
                      attachmentPicker.clear();
                      setDismissedErrorMessage(null);
                      typingSignal.stop(activeId);
                      const replyToId = replyTarget?.id;
                      setReplyTarget(null);
                      sendMessage.mutate({ text, clientId, files, replyToId, preview });
                    }}
                  >
                  <AttachmentComposerTray
                    error={attachmentPicker.error}
                    files={attachmentPicker.files}
                    onRemove={attachmentPicker.remove}
                  />
                  <LinkPreviewTray
                    isLoading={linkPreview.isLoading}
                    onDismiss={linkPreview.dismiss}
                    preview={linkPreview.preview}
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
                    disabled={Boolean(messageEdit.target)}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <FiPaperclip />
                  </button>
                  <input
                    onChange={(event) => {
                      setDraft(event.target.value);
                      if (!messageEdit.target && event.target.value.trim()) typingSignal.ping(activeId);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && messageEdit.target) messageEdit.leave();
                    }}
                    onPaste={handleDraftPaste}
                    placeholder={messageEdit.target ? "Edit your message..." : "Send an encrypted message..."}
                    ref={composerInputRef}
                    value={draft}
                  />
                  <button
                    aria-label={messageEdit.target ? "Save edit" : "Send"}
                    disabled={
                      messageEdit.target
                        ? !draft.trim()
                        : !draft.trim() && attachmentPicker.files.length === 0
                    }
                    type="submit"
                  >
                    {messageEdit.target ? <FiCheck /> : <FiSend />}
                  </button>
                  </form>
                </>
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
            </>
          ) : (
            <NoChatSelected />
          )}
        </section>

        <ConversationInfoPanel
          canVerify={canVerify}
          conversation={activeConversation}
          displayImage={activeConversationImage}
          displayName={activeConversationName}
          encryptionStatus={encryptionStatus}
          fileAttachments={flatOtherAttachments}
          isBlockPending={conversationActions.block.isPending}
          isGroup={activeConversation?.type === "GROUP"}
          isOpen={isConversationInfoOpen && Boolean(activeConversation)}
          key={activeId || "no-conversation"}
          manageButtonRef={groupSettingsButtonRef}
          onBlock={() => conversationActions.block.mutate(activeId)}
          onClose={() => setIsConversationInfoOpen(false)}
          onManageGroup={() => setIsGroupSettingsOpen(true)}
          onOpenAttachment={setLightboxKey}
          onVerify={() => setVerifyPeerId(verifyPeerCandidate)}
          search={{
            messagesById,
            hiddenMessageIds,
            history: {
              hasMoreHistory,
              isLoadingOlder,
              isWaitingOnRateLimit,
              rateLimitSecondsLeft,
              historyError,
              retryHistory,
              loadOlderMessages,
            },
            onJump: jumpToMessage,
          }}
          searchSeed={searchSeed?.conversationId === activeId ? searchSeed : null}
          userId={user?.id}
          verifyLabel={verifyLabel}
          visualAttachments={flatAttachments}
        />
      </div>

      <RemoveMessageDialog onClose={() => setRemoveTarget(null)} onConfirm={confirmRemove} target={removeTarget} />

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
