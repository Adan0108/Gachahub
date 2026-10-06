"use client";

import { useCallback, useRef, useState } from "react";
import {
  FiArchive,
  FiBell,
  FiBellOff,
  FiChevronLeft,
  FiFlag,
  FiInbox,
  FiMoreHorizontal,
  FiTrash2,
  FiUser,
  FiUserX,
} from "react-icons/fi";
import { useConversationActions } from "../../hooks/chat/useConversationActions";
import { useConversationMute } from "../../hooks/chat/useConversationMute";
import { floatingPortal, floatingStyle, useFloatingPosition } from "../../hooks/chat/useFloatingPosition";
import { useMenuDismiss } from "../../hooks/chat/useMenuDismiss";
import { useToast } from "../../hooks/useToast";
import { conversationDisplayName, conversationMute } from "../../lib/chat/chatDisplay";
import { MUTE_OPTIONS, UNMUTE, muteChange } from "../../lib/chat/muteDurations";
import { ConfirmChatActionDialog } from "./ConfirmChatActionDialog";

const CONFIRMATIONS = {
  block: {
    title: (name) => `Block ${name}?`,
    body: "You won't be able to read or send messages in this chat anymore.",
    confirmLabel: "Block",
    error: "Couldn't block this chat. Try again.",
  },
  delete: {
    title: () => "Delete this chat?",
    body: "It disappears for you only. The other people keep their copy.",
    confirmLabel: "Delete chat",
    error: "Couldn't delete this chat. Try again.",
  },
};

/** The three-dot button on a chat row and its menu; block and delete ask first, profile and report say they are not built yet. */
export function ConversationRowMenu({ conversation, userId, view, onGone }) {
  const [isOpen, setIsOpen] = useState(false);
  const [screen, setScreen] = useState("main");
  const [confirming, setConfirming] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const position = useFloatingPosition(isOpen, buttonRef, menuRef, { align: "end" });
  const actions = useConversationActions({ onGone });
  const mute = useConversationMute(conversation.id);
  const { notice, showNotice } = useToast();
  const { isMuted } = conversationMute(conversation, userId);
  const isGroup = conversation.type === "GROUP";
  const name = conversationDisplayName(conversation, userId);

  const close = useCallback(() => {
    setIsOpen(false);
    setScreen("main");
  }, []);
  useMenuDismiss(isOpen, close, buttonRef, menuRef);

  const notAvailable = (label) => {
    close();
    showNotice(`${label} isn't available yet.`);
  };
  const ask = (which) => {
    close();
    actions[which === "block" ? "block" : "remove"].reset();
    setConfirming(which);
  };
  const run = (mutation) => {
    close();
    mutation.mutate(conversation.id, { onError: () => showNotice("Couldn't do that. Try again.") });
  };
  const choose = (option) => {
    close();
    mute.mutate(muteChange(option));
  };

  const confirmation = confirming ? CONFIRMATIONS[confirming] : null;
  const confirmMutation = confirming === "block" ? actions.block : actions.remove;

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Options for ${name}`}
        className={`chat-row-more${isOpen ? " open" : ""}`}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        ref={buttonRef}
        type="button"
      >
        <FiMoreHorizontal aria-hidden="true" />
      </button>

      {isOpen &&
        floatingPortal(
          <div className="chat-menu" ref={menuRef} role="menu" style={floatingStyle(position)}>
            {screen === "main" ? (
              <>
                {!isGroup && (
                  <button onClick={() => notAvailable("Viewing a profile")} role="menuitem" type="button">
                    <FiUser aria-hidden="true" /> View profile
                  </button>
                )}
                {isMuted ? (
                  <button
                    disabled={mute.isPending}
                    onClick={() => {
                      close();
                      mute.mutate(UNMUTE);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <FiBellOff aria-hidden="true" /> Unmute notifications
                  </button>
                ) : (
                  <button onClick={() => setScreen("mute")} role="menuitem" type="button">
                    <FiBell aria-hidden="true" /> Mute notifications
                  </button>
                )}
                <div className="chat-menu-divider" role="separator" />
                {!isGroup && (
                  <button className="danger" onClick={() => ask("block")} role="menuitem" type="button">
                    <FiUserX aria-hidden="true" /> Block
                  </button>
                )}
                {view === "archived" && (
                  <button onClick={() => run(actions.unarchive)} role="menuitem" type="button">
                    <FiInbox aria-hidden="true" /> Unarchive chat
                  </button>
                )}
                {view === "inbox" && (
                  <button onClick={() => run(actions.archive)} role="menuitem" type="button">
                    <FiArchive aria-hidden="true" /> Archive chat
                  </button>
                )}
                <button className="danger" onClick={() => ask("delete")} role="menuitem" type="button">
                  <FiTrash2 aria-hidden="true" /> Delete chat
                </button>
                <button className="danger" onClick={() => notAvailable("Reporting")} role="menuitem" type="button">
                  <FiFlag aria-hidden="true" /> Report
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setScreen("main")} role="menuitem" type="button">
                  <FiChevronLeft aria-hidden="true" /> Mute for
                </button>
                <div className="chat-menu-divider" role="separator" />
                {MUTE_OPTIONS.map((option) => (
                  <button key={option.id} onClick={() => choose(option)} role="menuitem" type="button">
                    {option.label}
                  </button>
                ))}
              </>
            )}
          </div>,
        )}

      {confirmation && (
        <ConfirmChatActionDialog
          body={confirmation.body}
          confirmLabel={confirmation.confirmLabel}
          error={confirmMutation.isError ? confirmation.error : ""}
          isOpen
          isPending={confirmMutation.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => confirmMutation.mutate(conversation.id, { onSuccess: () => setConfirming(null) })}
          title={confirmation.title(name)}
        />
      )}

      {notice && floatingPortal(<div className="chat-row-toast" role="status">{notice}</div>)}
    </>
  );
}
