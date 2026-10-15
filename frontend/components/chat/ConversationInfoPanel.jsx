"use client";

import { useEffect, useRef, useState } from "react";
import {
  FiArrowLeft,
  FiFile,
  FiFlag,
  FiImage,
  FiLock,
  FiSearch,
  FiShield,
  FiUser,
  FiUsers,
  FiUserX,
  FiX,
} from "react-icons/fi";
import { AttachmentFileChip } from "./AttachmentFileChip";
import { MuteRow } from "./MuteRow";
import { ImageTile, VideoTile } from "./AttachmentTiles";
import { ConfirmChatActionDialog } from "./ConfirmChatActionDialog";
import { ConversationSearchView } from "./ConversationSearchView";
import { CONFIRMATIONS } from "../../lib/chat/chatActionConfirmations";
import { AttachmentLightboxContext } from "../../lib/mls/media/attachmentLightboxContext";
import { attachmentKind } from "../../lib/mls/media/attachmentView";
import { AvatarFace } from "../AvatarFace";

const NOT_IMPLEMENTED_TOAST_MS = 1800;
const PANEL_TITLES = { main: "Conversation info", media: "Media", files: "Files", search: "Search" };

/**
 * Right-docked panel: who you're talking to, shared media/files, and conversation-level actions.
 * Not a modal - the main thread stays interactive alongside it, so it doesn't use the app's usual
 * modal focus trap.
 */
export function ConversationInfoPanel({
  isOpen,
  displayName,
  displayImage,
  encryptionStatus,
  onClose,
  visualAttachments,
  fileAttachments,
  onOpenAttachment,
  canVerify,
  verifyLabel,
  onVerify,
  onBlock,
  isBlockPending,
  isGroup,
  onManageGroup,
  manageButtonRef,
  conversation,
  userId,
  search,
  searchSeed,
}) {
  const [view, setView] = useState(searchSeed ? "search" : "main");
  // A search started from the sidebar opens this panel on the search view with its text.
  const [appliedSeed, setAppliedSeed] = useState(searchSeed);
  const [toast, setToast] = useState(null);
  const [isConfirmingBlock, setIsConfirmingBlock] = useState(false);
  const toastTimerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  if (searchSeed !== appliedSeed) {
    setAppliedSeed(searchSeed);
    if (searchSeed) setView("search");
  }

  if (!isOpen) return null;

  const notImplemented = (label) => {
    window.clearTimeout(toastTimerRef.current);
    setToast(`${label} isn't available yet.`);
    toastTimerRef.current = window.setTimeout(() => setToast(null), NOT_IMPLEMENTED_TOAST_MS);
  };

  return (
    <AttachmentLightboxContext.Provider value={onOpenAttachment}>
      <aside aria-label="Conversation info" className="chat-conversation-info">
        <div className="chat-info-head">
          <button
            aria-label={view === "main" ? "Close conversation info" : "Back"}
            onClick={() => (view === "main" ? onClose() : setView("main"))}
            type="button"
          >
            {view === "main" ? <FiX /> : <FiArrowLeft />}
          </button>
          <b>{PANEL_TITLES[view]}</b>
        </div>

        {view === "main" && (
          <div className="chat-info-body">
            <div className="chat-info-banner" />
            <div className="chat-info-profile">
              <span className="chat-avatar large">
                <AvatarFace image={displayImage} name={displayName} />
              </span>
              <b>{displayName}</b>
              <span className="chat-info-encryption-badge">
                <FiLock aria-hidden="true" /> {encryptionStatus}
              </span>
            </div>

            <div className="chat-info-quick-actions">
              <button onClick={() => notImplemented("Viewing a profile")} type="button">
                <span className="chat-info-quick-icon">
                  <FiUser />
                </span>
                Profile
              </button>
              <button onClick={() => setView("search")} type="button">
                <span className="chat-info-quick-icon">
                  <FiSearch />
                </span>
                Search
              </button>
            </div>

            <div className="chat-info-section">
              <b className="chat-info-section-label">Media and files</b>
              <button className="chat-info-row" onClick={() => setView("media")} type="button">
                <FiImage /> Media
                <small>{visualAttachments.length}</small>
              </button>
              <button className="chat-info-row" onClick={() => setView("files")} type="button">
                <FiFile /> Files
                <small>{fileAttachments.length}</small>
              </button>
            </div>

            <div className="chat-info-section">
              {isGroup && (
                <button
                  className="chat-info-row"
                  onClick={onManageGroup}
                  ref={manageButtonRef}
                  type="button"
                >
                  <FiUsers /> Manage group
                </button>
              )}
              <MuteRow conversation={conversation} />
              {canVerify && (
                <button className="chat-info-row" onClick={onVerify} type="button">
                  <FiShield /> {verifyLabel}
                </button>
              )}
              {/* Block is a per-conversation lockout with no way to undo it (chat-inbox.service.ts) -
                  fine for leaving a DM behind for good, but on a group it would just cut this user
                  off from the whole group instead of the person they actually want gone. Leaving is
                  the group-appropriate equivalent, already inside Manage group. */}
              {!isGroup && (
                <button
                  className="chat-info-row danger"
                  disabled={isBlockPending}
                  onClick={() => setIsConfirmingBlock(true)}
                  type="button"
                >
                  <FiUserX /> Block
                </button>
              )}
              <button
                className="chat-info-row danger"
                onClick={() => notImplemented("Reporting")}
                type="button"
              >
                <FiFlag /> Report
              </button>
            </div>
          </div>
        )}

        {view === "media" && (
          <div className="chat-info-body">
            {visualAttachments.length === 0 ? (
              <p className="chat-info-empty">No media in this conversation yet.</p>
            ) : (
              <div className="chat-info-media-grid">
                {visualAttachments.map((item) => {
                  const Tile = attachmentKind(item.file.mime) === "video" ? VideoTile : ImageTile;
                  return (
                    <Tile
                      file={item.file}
                      key={item.cacheKey}
                      source={item.source}
                      thumbSource={item.thumbSource}
                      uniform
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {view === "files" && (
          <div className="chat-info-body">
            {fileAttachments.length === 0 ? (
              <p className="chat-info-empty">No files in this conversation yet.</p>
            ) : (
              <div className="chat-info-file-list">
                {fileAttachments.map((item) => (
                  <AttachmentFileChip file={item.file} key={item.cacheKey} source={item.source} />
                ))}
              </div>
            )}
          </div>
        )}

        {view === "search" && (
          <ConversationSearchView
            conversation={conversation}
            initialQuery={appliedSeed?.query}
            key={appliedSeed?.nonce ?? "manual"}
            targetMessageId={appliedSeed?.messageId}
            userId={userId}
            {...search}
          />
        )}

        {toast && (
          <div className="chat-info-toast" role="status">
            {toast}
          </div>
        )}
        <ConfirmChatActionDialog
          body={CONFIRMATIONS.block.body}
          confirmLabel={CONFIRMATIONS.block.confirmLabel}
          isOpen={isConfirmingBlock}
          isPending={isBlockPending}
          onClose={() => setIsConfirmingBlock(false)}
          onConfirm={() => {
            setIsConfirmingBlock(false);
            onBlock();
          }}
          title={CONFIRMATIONS.block.title(displayName)}
        />
      </aside>
    </AttachmentLightboxContext.Provider>
  );
}
