"use client";

import { FiFile, FiPlay, FiX } from "react-icons/fi";
import { useLocalFileUrl } from "../../hooks/useLocalFileUrl";
import { attachmentKind, formatBytes } from "../../lib/mls/media/attachmentView";
import "./ChatAttachments.css";

/** The tile's picture - the real image or first video frame for those, a plain icon otherwise. */
function TilePreview({ file }: { file: File }) {
  const kind = attachmentKind(file.type);
  const url = useLocalFileUrl(file, kind !== "file");
  if (kind === "image" && url) return <img alt="" src={url} />;
  if (kind === "video" && url) {
    return (
      <>
        <video muted src={url} />
        <FiPlay aria-hidden="true" className="chat-draft-tile-play" />
      </>
    );
  }
  return (
    <>
      <FiFile aria-hidden="true" className="chat-draft-tile-icon" />
      <span className="chat-draft-tile-name">{file.name}</span>
    </>
  );
}

/** Files chosen but not yet sent, as small tiles with a corner button to take each back out. */
export function AttachmentComposerTray({
  files,
  onRemove,
  error,
}: {
  files: File[];
  onRemove: (index: number) => void;
  error?: string | null;
}) {
  if (files.length === 0 && !error) return null;
  return (
    <div className="chat-attachment-tray">
      {files.length > 0 && (
        <ul aria-label="Files to send" className="chat-draft-tiles">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} title={`${file.name} (${formatBytes(file.size)})`}>
              <TilePreview file={file} />
              <button aria-label={`Remove ${file.name}`} onClick={() => onRemove(index)} type="button">
                <FiX />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="chat-attachment-error">{error}</span>}
    </div>
  );
}
