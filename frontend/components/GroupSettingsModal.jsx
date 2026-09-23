"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FiLogOut, FiX } from "react-icons/fi";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import { api } from "../lib/api";
import { activeMembers, initialOf, myParticipant, parseUserIds } from "../lib/chatDisplay";

/**
 * Group management: title/photo, member list with roles, promote/demote and transfer ownership
 * (owner-only), add/remove members, leave group. Pulled out of chat/page.jsx as its own concern -
 * everything here reads or mutates a group conversation's own settings, distinct from the thread
 * itself.
 *
 * `refreshChat` and `onLeft` are the only things this needs from the parent beyond the
 * conversation itself: refetching the conversation lists after any change, and clearing the
 * parent's selected conversation once this device leaves the group.
 *
 * The parent must render this with `key={isOpen ? conversation?.id : "closed"}` (see
 * chat/page.jsx) - that forces a fresh mount every time it opens, which is what seeds the
 * editable fields from the current conversation with no effect needed, and discards any
 * abandoned edits from a previous time it was open instead of them lingering in memory.
 */
export function GroupSettingsModal({
  conversation,
  currentUserId,
  isOpen,
  onClose,
  triggerRef,
  refreshChat,
  onLeft,
}) {
  const modalRef = useModalFocusTrap(isOpen, onClose, triggerRef);
  const conversationId = conversation?.id;

  const [title, setTitle] = useState(conversation?.title || "");
  const [photoUrl, setPhotoUrl] = useState(conversation?.photoUrl || "");
  const [addMemberIdsText, setAddMemberIdsText] = useState("");

  const updateGroupDetails = useMutation({
    mutationFn: () =>
      api.updateGroupChat(conversationId, {
        title: title.trim(),
        photoUrl: photoUrl.trim() || undefined,
      }),
    onSuccess: refreshChat,
  });
  const addMembers = useMutation({
    mutationFn: () => api.addGroupMembers(conversationId, parseUserIds(addMemberIdsText)),
    onSuccess: async () => {
      setAddMemberIdsText("");
      await refreshChat();
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId) => api.removeGroupMembers(conversationId, [userId]),
    onSuccess: refreshChat,
  });
  const changeMemberRole = useMutation({
    mutationFn: ({ userId, role }) => api.updateGroupMemberRole(conversationId, userId, role),
    onSuccess: refreshChat,
  });
  const transferOwnership = useMutation({
    mutationFn: (userId) => api.transferGroupOwnership(conversationId, userId),
    onSuccess: refreshChat,
  });
  const leaveGroup = useMutation({
    mutationFn: () => api.leaveGroup(conversationId),
    onSuccess: async () => {
      onClose();
      onLeft?.();
      await refreshChat();
    },
  });

  if (!isOpen || !conversation) {
    return null;
  }

  const activeGroupMembers = activeMembers(conversation);
  const myGroupParticipant = myParticipant(conversation, currentUserId);
  const isGroupOwner = myGroupParticipant?.role === "OWNER";
  const canManageGroup = isGroupOwner || myGroupParticipant?.role === "ADMIN";
  const canLeaveGroup = !isGroupOwner || activeGroupMembers.length <= 1;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-modal="true"
        className="modal group-settings-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="panel-head">
          <h2>Group settings</h2>
          <button aria-label="Close group settings" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>

        {canManageGroup && (
          <form
            className="group-settings-details"
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim() || updateGroupDetails.isPending) return;
              updateGroupDetails.mutate();
            }}
          >
            <label htmlFor="group-settings-title">
              Group name
              <input
                id="group-settings-title"
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </label>
            <label htmlFor="group-settings-photo">
              Photo URL
              <input
                id="group-settings-photo"
                onChange={(event) => setPhotoUrl(event.target.value)}
                placeholder="https://..."
                value={photoUrl}
              />
            </label>
            <button
              className="primary"
              disabled={!title.trim() || updateGroupDetails.isPending}
              type="submit"
            >
              {updateGroupDetails.isPending ? "Saving..." : "Save changes"}
            </button>
            {updateGroupDetails.error && <small>{updateGroupDetails.error.message}</small>}
          </form>
        )}

        <div className="group-member-list">
          <h3>Members ({activeGroupMembers.length})</h3>
          {conversation.participants
            .filter((participant) => participant.state !== "DECLINED")
            .map((participant) => {
              const isSelf = participant.userId === currentUserId;
              const canActOnMember = !isSelf && participant.state === "ACTIVE";
              return (
                <div className="group-member-row" key={participant.userId}>
                  <span className="chat-avatar small">{initialOf(participant.user?.name)}</span>
                  <span className="group-member-name">
                    <b>
                      {participant.user?.name || "GachaHub member"}
                      {isSelf ? " (You)" : ""}
                    </b>
                    <small>
                      <span className="tag">{participant.role}</span>
                      {participant.state === "PENDING" && <span className="tag">Invited</span>}
                      {participant.state === "LEAVING" && <span className="tag">Leaving…</span>}
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
  );
}
