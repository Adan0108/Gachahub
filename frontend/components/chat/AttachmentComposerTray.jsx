"use client";

import { FiFile, FiX } from "react-icons/fi";
import { useLocalFileUrl } from "../../hooks/useLocalFileUrl";
import { attachmentKind, formatBytes } from "../../lib/mls/media/attachmentView";
import "./ChatAttachments.css";

/** The chip's own thumbnail - the real image/first video frame for those, a plain icon otherwise. */
function AttachmentPreview({ file }) {
  const kind = attachmentKind(file.type);
  const url = useLocalFileUrl(file, kind !== "file");
  if (kind === "image" && url) return <img alt="" className="chat-attachment-chip-thumb" src={url} />;
  if (kind === "video" && url) {
    return <video className="chat-attachment-chip-thumb" muted src={url} />;
  }
  return <FiFile aria-hidden="true" />;
}

/** Files chosen but not yet sent; each can still be dropped. */
export function AttachmentComposerTray({ files, onRemove, error }) {
  if (files.length === 0 && !error) return null;
  return (
    <div className="chat-attachment-tray">
      {files.map((file, index) => (
        <div className="chat-attachment-chip" key={`${file.name}-${index}`}>
          <AttachmentPreview file={file} />
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
