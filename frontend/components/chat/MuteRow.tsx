"use client";
import type { ChatConversation } from "../../lib/chat/chatDisplay";
import type { MuteOption } from "../../lib/chat/muteDurations";

import { useCallback, useRef, useState } from "react";
import { FiBell, FiBellOff, FiChevronDown } from "react-icons/fi";
import { useConversationMute } from "../../hooks/chat/useConversationMute";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useDismiss } from "../../hooks/useDismiss";
import { conversationMute } from "../../lib/chat/chatDisplay";
import { MUTE_OPTIONS, UNMUTE, describeMutedUntil, muteChange } from "../../lib/chat/muteDurations";

/** The one mute control: Mute opens the duration menu, Unmute (shown while muted) switches it straight back on. */
export function MuteRow({ conversation }: { conversation: ChatConversation }) {
  const { user } = useCurrentUser();
  const { isMuted, mutedUntil } = conversationMute(conversation, user?.id);
  const mute = useConversationMute(conversation.id);
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismiss({ isOpen: open, onDismiss: close, contentRef: menuRef, triggerRef: rowRef });

  const choose = (option: MuteOption) => {
    setOpen(false);
    mute.mutate(muteChange(option));
  };

  return (
    <>
      {isMuted ? (
        <button
          className="chat-info-row"
          disabled={mute.isPending}
          onClick={() => mute.mutate(UNMUTE)}
          type="button"
        >
          <FiBellOff aria-hidden="true" /> Unmute
          <small>{describeMutedUntil(mutedUntil)}</small>
        </button>
      ) : (
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          className="chat-info-row"
          disabled={mute.isPending}
          onClick={() => setOpen((current) => !current)}
          ref={rowRef}
          type="button"
        >
          <FiBell aria-hidden="true" /> Mute notifications
          <FiChevronDown aria-hidden="true" className="chat-info-row-chevron" />
        </button>
      )}
      {open && !isMuted && (
        <div aria-label="Mute for" className="chat-info-mute-menu" ref={menuRef} role="menu">
          {MUTE_OPTIONS.map((option) => (
            <button key={option.id} onClick={() => choose(option)} role="menuitem" type="button">
              {option.label}
            </button>
          ))}
        </div>
      )}
      {mute.isError && (
        <p className="chat-info-error" role="alert">
          Couldn&apos;t update mute. Try again.
        </p>
      )}
    </>
  );
}
