"use client";

import Link from "next/link";
import { FiHash, FiLock } from "react-icons/fi";
import { ConfirmChatActionDialog } from "../chat/ConfirmChatActionDialog";
import { JumpToBottomButton } from "../chat/JumpToBottomButton";
import { useCommunityChat } from "../../hooks/community/useCommunityChat";
import { useCommunityThread } from "../../hooks/community/useCommunityThread";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { CommunityComposer } from "./CommunityComposer";
import { CommunityMessageRow } from "./CommunityMessageRow";
import { CommunityPendingRow } from "./CommunityPendingRow";
import { CommunitySkeleton } from "./CommunitySkeleton";
import "./CommunityChat.css";

/** The chat room of one game community: history, live messages, and the composer. */
export function CommunityChat({
  slug,
  communityName,
  isJoined,
  isCheckingMembership,
  canJoin,
  isJoining,
  onJoin,
}) {
  const { user } = useCurrentUser();
  // Only members get in, so asking before joining would be a request that is certain to be refused.
  const chat = useCommunityChat(slug, { enabled: Boolean(user) && isJoined });
  const {
    now,
    rows,
    listRef,
    onScroll,
    scrollToBottom,
    showJumpToBottom,
    loadOlder,
    jumpTo,
    replyTo,
    setReplyTo,
    send,
    setRemoveTarget,
    removeTarget,
    confirmRemove,
    closeRemove,
  } = useCommunityThread(chat);

  if (!user) {
    return (
      <section className="community-chat gate">
        <h3>Log in to chat</h3>
        <p>Join the conversation with other {communityName} players.</p>
        <Link className="primary" href="/login">
          Log in
        </Link>
      </section>
    );
  }

  if (isCheckingMembership && !isJoined) {
    return (
      <section className="community-chat">
        <CommunitySkeleton />
      </section>
    );
  }

  if (chat.needsToJoin || !isJoined) {
    return (
      <section className="community-chat gate">
        <FiLock aria-hidden="true" />
        <h3>Join {communityName} to chat</h3>
        <p>
          Community chat is open to members. Messages here are public to members and moderators.
        </p>
        {canJoin && (
          <button className="primary" disabled={isJoining} onClick={onJoin} type="button">
            + Join community
          </button>
        )}
      </section>
    );
  }

  if (chat.error) {
    return (
      <section className="community-chat gate">
        <h3>Chat unavailable</h3>
        <p>{chat.error.message || "The chat could not be loaded."}</p>
        <button className="soft-btn" onClick={chat.reload} type="button">
          Try again
        </button>
      </section>
    );
  }

  if (!chat.channel) {
    return (
      <section className="community-chat">
        <CommunitySkeleton />
      </section>
    );
  }

  const { channel } = chat;
  const lockedReason =
    (channel.isLocked || channel.kind === "ANNOUNCEMENT") && !chat.canModerate
      ? channel.kind === "ANNOUNCEMENT"
        ? "Only moderators can post in this channel."
        : "This channel is locked."
      : null;

  return (
    <section className="community-chat" aria-label={`${communityName} chat`}>
      <header className="community-chat-head">
        <FiHash aria-hidden="true" />
        <h3>{channel.name}</h3>
        <small>{channel.topic || "Public to community members and moderators"}</small>
      </header>

      <div className="community-list-wrap">
        <div className="community-list" onScroll={onScroll} ref={listRef}>
          {chat.hasOlder && (
            <button
              className="community-older"
              disabled={chat.isLoadingOlder}
              onClick={loadOlder}
              type="button"
            >
              {chat.isLoadingOlder ? "Loading..." : "Load earlier messages"}
            </button>
          )}
          {chat.isLoading && <CommunitySkeleton />}
          {!chat.isLoading && rows.length === 0 && chat.pending.length === 0 && (
            <div className="community-empty">
              <b>Welcome to #{channel.name}</b>
              <p>This is the start of the {communityName} chat. Say hi!</p>
            </div>
          )}
          {rows.map((row) =>
            row.kind === "day" ? (
              <div className="community-day" key={row.key}>
                <span>{row.label}</span>
              </div>
            ) : (
              <CommunityMessageRow
                canModerate={chat.canModerate}
                editState={{
                  isPending: chat.edit.isPending,
                  error: chat.edit.error?.message,
                  reset: chat.edit.reset,
                }}
                key={row.key}
                message={row.message}
                now={now}
                onJumpTo={jumpTo}
                onReact={(messageId, choice) => chat.react.mutate({ messageId, choice })}
                onRemove={setRemoveTarget}
                onReply={setReplyTo}
                onSaveEdit={(messageId, content) => chat.edit.mutateAsync({ messageId, content })}
                showHeader={row.showHeader}
                userId={user.id}
              />
            ),
          )}
          {chat.pending.map((entry) => (
            <CommunityPendingRow
              entry={entry}
              key={entry.clientId}
              onDiscard={chat.discard}
              onRetry={chat.retry}
              user={user}
            />
          ))}
        </div>
        <JumpToBottomButton onClick={() => scrollToBottom("smooth")} visible={showJumpToBottom} />
      </div>

      <CommunityComposer
        channel={channel}
        disabledReason={lockedReason}
        onCancelReply={() => setReplyTo(null)}
        onSend={send}
        replyTo={replyTo}
      />

      <ConfirmChatActionDialog
        body="This removes the message for everyone in the community. This can't be undone."
        confirmLabel="Remove message"
        error={chat.remove.error?.message}
        isOpen={Boolean(removeTarget)}
        isPending={chat.remove.isPending}
        onClose={closeRemove}
        onConfirm={confirmRemove}
        title="Remove this message?"
      />
    </section>
  );
}
