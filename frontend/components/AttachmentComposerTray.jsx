"use client";

import { FiFile, FiX } from "react-icons/fi";
import { formatBytes } from "../lib/mls/media/attachmentView";
import "./ChatAttachments.css";

/** Files chosen but not yet sent; each can still be dropped. */
export function AttachmentComposerTray({ files, onRemove, error }) {
  if (files.length === 0 && !error) return null;
  return (
    <div className="chat-attachment-tray">
      {files.map((file, index) => (
        <div className="chat-attachment-chip" key={`${file.name}-${index}`}>
          <FiFile aria-hidden="true" />
          <span className="chat-attachment-name" title={file.name}>
            {file.name}
          </span>
          <small>{formatBytes(file.size)}</small>
          <button
            aria-label={`Remove ${file.name}`}
            className="chat-attachment-remove"
            onClick={() => onRemove(index)}
            type="button"
          >
            <FiX />
          </button>
        </div>
      ))}
      {error && <span className="chat-attachment-error">{error}</span>}
    </div>
  );
}
