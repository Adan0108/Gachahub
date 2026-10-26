"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  FiAward,
  FiLogOut,
  FiMoreHorizontal,
  FiShield,
  FiStar,
  FiUserMinus,
  FiUserPlus,
  FiUsers,
} from "react-icons/fi";
import { floatingPortal, floatingStyle, useFloatingPosition } from "../../hooks/chat/useFloatingPosition";
import { useMenuDismiss } from "../../hooks/chat/useMenuDismiss";
import { api } from "../../lib/api";
import { activeMembers, idsInGroup, myParticipant } from "../../lib/chat/chatDisplay";
import type { ChatConversation, ChatParticipant } from "../../lib/chat/chatDisplay";
import type { UserSearchResult } from "../../hooks/chat/useUserSearch";
import { AddPeopleDialog } from "./AddPeopleDialog";
import { ConfirmChatActionDialog } from "./ConfirmChatActionDialog";
import { InfoSectionToggle } from "./InfoSectionToggle";
import { MemberAvatar } from "./MemberAvatar";

const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin" };

type MenuItem =
  | { id: string; icon: ReactNode; label: string; danger?: boolean; divider?: undefined }
  | { divider: true; id?: undefined; icon?: undefined; label?: undefined; danger?: undefined };
type ConfirmKind = "remove" | "owner" | "owner-first" | "leave";
type Confirming = { kind: ConfirmKind; participant?: ChatParticipant } | null;
type DialogSpec = {
  title: (participant?: ChatParticipant) => string;
  body: (participant?: ChatParticipant) => string;
  confirmLabel: string;
  mutation: { isPending: boolean };
};
type SafetyByUser = Record<string, { pairNumber?: string | null; status?: string } | undefined>;

/** The three-dot menu of one member: what you may do to them, with the destructive choice set apart. */
function MemberMenu({
  name,
  items,
  onPick,
}: {
  name: string;
  items: MenuItem[];
  onPick: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useFloatingPosition(isOpen, buttonRef, menuRef, { align: "end" });
  const close = useCallback(() => setIsOpen(false), []);
  useMenuDismiss(isOpen, close, buttonRef, menuRef);

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Options for ${name}`}
        className="chat-info-member-more"
        onClick={() => setIsOpen((open) => !open)}
        ref={buttonRef}
        type="button"
      >
        <FiMoreHorizontal aria-hidden="true" />
      </button>
      {isOpen &&
        floatingPortal(
          <div className="chat-menu" ref={menuRef} role="menu" style={floatingStyle(position)}>
            {items.map((item: MenuItem) =>
              item.divider ? (
                <div className="chat-menu-divider" key="divider" role="separator" />
              ) : (
                <button
                  className={item.danger ? "danger" : undefined}
                  key={item.id}
                  onClick={() => {
                    close();
                    onPick(item.id ?? "");
                  }}
                  role="menuitem"
                  type="button"
                >
                  {item.icon} {item.label}
                </button>
              ),
            )}
          </div>,
        )}
    </>
  );
}

/** Members, adding people and leaving, inside the conversation info panel. */
export function GroupMembersSection({
  conversation,
  currentUserId,
  safety = {},
  isOpen,
  onToggleOpen,
  isAdding,
  onToggleAdding,
  onVerify,
  onChanged,
  onLeft,
}: {
  conversation: ChatConversation;
  currentUserId?: string;
  safety?: SafetyByUser;
  isOpen: boolean;
  onToggleOpen: () => void;
  isAdding: boolean;
  onToggleAdding: (adding: boolean) => void;
  onVerify?: (userId: string) => void;
  onChanged?: () => unknown;
  onLeft?: () => void;
}) {
  const conversationId = conversation.id;
  // { kind: "remove" | "owner" | "leave", participant? }
  const [confirming, setConfirming] = useState<Confirming>(null);

  const members = activeMembers(conversation);
  const me = myParticipant(conversation, currentUserId);
  const isOwner = me?.role === "OWNER";
  const canManage = isOwner || me?.role === "ADMIN";
  const canLeave = !isOwner || members.length <= 1;

  const addMembers = useMutation({
    mutationFn: (people: UserSearchResult[]) =>
      api.addGroupMembers(
        conversationId,
        people.map((member) => member.id),
      ),
    onSuccess: async () => {
      onToggleAdding(false);
      await onChanged?.();
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeGroupMembers(conversationId, [userId]),
    onSuccess: onChanged,
  });
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateGroupMemberRole(conversationId, userId, role),
    onSuccess: onChanged,
  });
  const transferOwnership = useMutation({
    mutationFn: (userId: string) => api.transferGroupOwnership(conversationId, userId),
    onSuccess: onChanged,
  });
  const leave = useMutation({
    mutationFn: () => api.leaveGroup(conversationId),
    onSuccess: async () => {
      onLeft?.();
      await onChanged?.();
    },
  });

  const itemsFor = (participant: ChatParticipant) => {
    const items: MenuItem[] = [];
    const hasSafety = Boolean(safety[participant.userId]?.pairNumber);
    if (hasSafety) {
      items.push({
        id: "verify",
        icon: <FiShield aria-hidden="true" />,
        label:
          safety[participant.userId]?.status === "verified" ? "Safety number" : "Verify safety number",
      });
    }
    if (isOwner && participant.role !== "OWNER") {
      items.push({
        id: "role",
        icon: <FiStar aria-hidden="true" />,
        label: participant.role === "ADMIN" ? "Remove as admin" : "Make admin",
      });
      items.push({ id: "owner", icon: <FiAward aria-hidden="true" />, label: "Make owner" });
    }
    if (canManage && participant.role !== "OWNER") {
      if (items.length) items.push({ divider: true });
      items.push({ id: "remove", icon: <FiUserMinus aria-hidden="true" />, label: "Remove from group", danger: true });
    }
    return items;
  };

  const pick = (participant: ChatParticipant, id: string) => {
    if (id === "verify") onVerify?.(participant.userId);
    if (id === "role") {
      changeRole.mutate({ userId: participant.userId, role: participant.role === "ADMIN" ? "MEMBER" : "ADMIN" });
    }
    if (id === "owner") setConfirming({ kind: "owner", participant });
    if (id === "remove") setConfirming({ kind: "remove", participant });
  };

  const actionError = changeRole.error || removeMember.error || transferOwnership.error;
  const nameOf = (participant?: ChatParticipant) => participant?.user?.name || "GachaHub member";

  const dialogs: Record<ConfirmKind, DialogSpec> = {
    remove: {
      title: (p?: ChatParticipant) => `Remove ${nameOf(p)}?`,
      body: () => "They will no longer be able to send or read new messages in this group.",
      confirmLabel: "Remove",
      mutation: removeMember,
    },
    owner: {
      title: (p?: ChatParticipant) => `Make ${nameOf(p)} the owner?`,
      body: () => "You will become an admin. Only the owner can change who is an admin or owner.",
      confirmLabel: "Make owner",
      mutation: transferOwnership,
    },
    // An owner with other members must hand the group over first: say so when they try, not before.
    "owner-first": {
      title: () => "Choose a new owner first",
      body: () => "You own this group. Make someone else the owner from the member list, then you can leave.",
      confirmLabel: "Got it",
      mutation: { isPending: false },
    },
    leave: {
      title: () => "Leave this group?",
      body: () => "You won't be able to send or read messages unless someone adds you back.",
      confirmLabel: "Leave group",
      mutation: leave,
    },
  };
  const dialog = confirming ? dialogs[confirming.kind] : undefined;

  const confirm = () => {
    if (!confirming) return;
    const { kind, participant } = confirming;
    if (kind === "owner-first") {
      setConfirming(null);
      return;
    }
    const run =
      kind === "leave"
        ? () => leave.mutate()
        : kind === "owner"
          ? () => participant && transferOwnership.mutate(participant.userId)
          : () => participant && removeMember.mutate(participant.userId);
    setConfirming(null);
    run();
  };

  return (
    <div className="chat-info-section chat-info-members">
      <InfoSectionToggle
        icon={<FiUsers aria-hidden="true" />}
        isOpen={isOpen}
        label={`Members (${members.length})`}
        onToggle={onToggleOpen}
      />

      {isOpen && canManage && (
        <button
          aria-haspopup="dialog"
          className="chat-info-row"
          onClick={() => onToggleAdding(true)}
          type="button"
        >
          <FiUserPlus aria-hidden="true" /> Add people
        </button>
      )}

      {isAdding && canManage && (
        <AddPeopleDialog
          error={addMembers.error as Error | null}
          excludeIds={idsInGroup(conversation)}
          isPending={addMembers.isPending}
          onAdd={(people) => addMembers.mutate(people)}
          onClose={() => {
            addMembers.reset();
            onToggleAdding(false);
          }}
        />
      )}

      {isOpen && (
      <ul className="chat-info-member-list">
        {conversation.participants
          .filter((participant: ChatParticipant) => participant.state !== "DECLINED")
          .map((participant: ChatParticipant) => {
            const isSelf = participant.userId === currentUserId;
            const items = !isSelf && participant.state === "ACTIVE" ? itemsFor(participant) : [];
            return (
              <li className="chat-info-member" key={participant.userId}>
                <MemberAvatar isSelf={isSelf} participant={participant} />
                <span className="chat-info-member-name">
                  <b>
                    {nameOf(participant)}
                    {isSelf ? " (You)" : ""}
                  </b>
                  <small>
                    {ROLE_LABEL[participant.role ?? ""] ?? "Member"}
                    {participant.state === "PENDING" && " · Invited"}
                    {participant.state === "LEAVING" && " · Leaving…"}
                    {safety[participant.userId]?.status === "verified" && " · Verified"}
                  </small>
                </span>
                {items.length > 0 && (
                  <MemberMenu items={items} name={nameOf(participant)} onPick={(id: string) => pick(participant, id)} />
                )}
              </li>
            );
          })}
      </ul>
      )}
      {actionError && (
        <small className="chat-info-error" role="alert">
          {actionError.message}
        </small>
      )}

      <button
        className="chat-info-row danger"
        disabled={leave.isPending}
        onClick={() => setConfirming({ kind: canLeave ? "leave" : "owner-first" })}
        type="button"
      >
        <FiLogOut aria-hidden="true" /> Leave group
      </button>
      {leave.error && (
        <small className="chat-info-error" role="alert">
          {leave.error.message}
        </small>
      )}

      {dialog && (
        <ConfirmChatActionDialog
          body={dialog.body(confirming?.participant)}
          confirmLabel={dialog.confirmLabel}
          isOpen
          isPending={dialog.mutation.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={confirm}
          title={dialog.title(confirming?.participant)}
        />
      )}
    </div>
  );
}
