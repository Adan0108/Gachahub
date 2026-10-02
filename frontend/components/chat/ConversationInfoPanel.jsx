"use client";

import { useEffect, useRef, useState } from "react";
import {
  FiArrowLeft,
  FiBell,
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
import { ImageTile, VideoTile } from "./AttachmentTiles";
import { AttachmentLightboxContext } from "../../lib/mls/media/attachmentLightboxContext";
import { attachmentKind } from "../../lib/mls/media/attachmentView";
import { initialOf } from "../../lib/chat/chatDisplay";

const NOT_IMPLEMENTED_TOAST_MS = 1800;

/**
 * Right-docked panel: who you're talking to, shared media/files, and conversation-level actions.
 * Not a modal - the main thread stays interactive alongside it, so it doesn't use the app's usual
 * modal focus trap.
 */
export function ConversationInfoPanel({
  isOpen,
  displayName,
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
}) {
  const [view, setView] = useState("main");
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

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
          <b>{view === "media" ? "Media" : view === "files" ? "Files" : "Conversation info"}</b>
        </div>

        {view === "main" && (
          <div className="chat-info-body">
            <div className="chat-info-banner" />
            <div className="chat-info-profile">
              <span className="chat-avatar large">{initialOf(displayName)}</span>
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
              <button onClick={() => notImplemented("Muting")} type="button">
                <span className="chat-info-quick-icon">
                  <FiBell />
                </span>
                Mute
              </button>
              <button onClick={() => notImplemented("Search in conversation")} type="button">
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
              <button
                className="chat-info-row"
                onClick={() => notImplemented("Muting notifications")}
                type="button"
              >
                <FiBell /> Mute notifications
              </button>
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
                  onClick={onBlock}
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

        {toast && (
          <div className="chat-info-toast" role="status">
            {toast}
          </div>
        )}
      </aside>
    </AttachmentLightboxContext.Provider>
  );
}
