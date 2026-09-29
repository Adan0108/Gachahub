"use client";

import { useLocalFileUrl } from "../hooks/useLocalFileUrl";
import {
  attachmentKind,
  chunkVisualAttachments,
  envelopeView,
  formatBytes,
} from "../lib/mls/media/attachmentView";
import { ChatAttachments } from "./ChatAttachments";
import "./ChatAttachments.css";

/** The body of one decrypted message bubble; envelope types this build can't show get a plain note. */
export function EnvelopeContent({ envelope, messageId, media }) {
  const view = envelopeView(envelope);
  if (view?.kind === "text") return <p>{view.text}</p>;
  if (view?.kind === "attachment") {
    return <ChatAttachments envelope={envelope} media={media} messageId={messageId} />;
  }
  return <p className="chat-message-unsupported">This message type isn&apos;t supported yet.</p>;
}

/** A local file's own preview while it's still going out: dimmed, with a spinner over it. */
function PendingTile({ file }) {
  const kind = attachmentKind(file.type);
  const url = useLocalFileUrl(file, kind !== "file");
  return (
    <div className="chat-attachment-tile pending">
      {kind === "image" && url && <img alt="" src={url} />}
      {kind === "video" && url && <video muted src={url} />}
      {(kind === "file" || !url) && <span className="chat-attachment-pending-name">{file.name}</span>}
      <span aria-hidden="true" className="chat-attachment-pending-spinner" />
    </div>
  );
}

/**
 * An outgoing bubble before the server has it: a dimmed, spinner-over preview of each file,
 * grouped the same way a sent message would be. Shares ChatAttachments's own root class so the
 * same CSS (flush-to-the-edges grid, inset caption/chips) applies to both without duplicating it.
 */
export function PendingContent({ text, files = [] }) {
  // A plain text message (no files) skips the .chat-attachments treatment entirely - that class
  // is what strips the bubble's own padding/border, which a text-only bubble still needs.
  if (files.length === 0) return text ? <p>{text}</p> : null;

  const visualFiles = files.filter((file) => attachmentKind(file.type) !== "file");
  const otherFiles = files.filter((file) => attachmentKind(file.type) === "file");
  const groups = chunkVisualAttachments(visualFiles);

  return (
    <div className="chat-attachments">
      {groups.length > 0 && (
        <div className="chat-attachment-media">
          {groups.map((group, groupIndex) => (
            <div className={`chat-attachment-grid count-${group.length}`} key={groupIndex}>
              {group.map((file, index) => (
                <PendingTile file={file} key={`${file.name}-${index}`} />
              ))}
            </div>
          ))}
        </div>
      )}
      {otherFiles.map((file, index) => (
        <p key={`${file.name}-${index}`}>
          {file.name} ({formatBytes(file.size)})
        </p>
      ))}
      {text && <p>{text}</p>}
    </div>
  );
}
