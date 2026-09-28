"use client";

import { envelopeView, formatBytes } from "../lib/mls/media/attachmentView";
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

/** An outgoing bubble before the server has it: caption plus the names of files still going out. */
export function PendingContent({ text, files = [] }) {
  return (
    <>
      {files.map((file, index) => (
        <p key={`${file.name}-${index}`}>
          {file.name} ({formatBytes(file.size)})
        </p>
      ))}
      {text && <p>{text}</p>}
    </>
  );
}
