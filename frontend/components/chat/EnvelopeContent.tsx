"use client";

import { useLocalFileUrl } from "../../hooks/useLocalFileUrl";
import { isAttachmentEnvelope } from "../../lib/mls/media/attachmentEnvelope";
import {
  attachmentKind,
  chunkVisualAttachments,
  envelopeView,
  formatBytes,
} from "../../lib/mls/media/attachmentView";
import { readLinkPreviews } from "../../lib/mls/messaging/linkPreviewEnvelope";
import { ChatAttachments } from "./ChatAttachments";
import { DraftLinkPreviewCard, ReceivedLinkPreviewCard } from "./LinkPreviewCard";
import { CommunityText } from "../community/CommunityText";
import { LinkifiedText } from "./LinkifiedText";
import { SharedPostCard } from "./SharedPostCard";
import "./ChatAttachments.css";
import type { LinkPreviewData } from "../../lib/mls/media/prepareLinkPreview";

/** The body of one decrypted message bubble; envelope types this build can't show get a plain note. `mentions`: handles of the people in the chat, picked out in colour. */
export function EnvelopeContent({
  envelope,
  messageId,
  media,
  mentions,
}: {
  envelope: unknown;
  messageId: string;
  media?: { mediaUploadId: string; url: string }[];
  mentions?: string[];
}) {
  const view = envelopeView(envelope);
  if (view?.kind === "text") {
    const previews = readLinkPreviews(envelope);
    if (previews.length === 0) {
      return (
        <p>
          <CommunityText content={view.text} mentions={mentions} />
        </p>
      );
    }
    return (
      <div className="chat-text-with-preview">
        <p>
          <CommunityText content={view.text} mentions={mentions} />
        </p>
        {previews.map((preview) => (
          <ReceivedLinkPreviewCard
            key={preview.url}
            media={media}
            messageId={messageId}
            preview={preview}
          />
        ))}
      </div>
    );
  }
  if (isAttachmentEnvelope(envelope)) {
    return <ChatAttachments envelope={envelope} media={media} messageId={messageId} />;
  }
  if (view?.kind === "post") {
    if (!view.caption) return <SharedPostCard postId={view.postId} />;
    return (
      <div className="chat-text-with-preview">
        <p>
          <CommunityText content={view.caption} mentions={mentions} />
        </p>
        <SharedPostCard postId={view.postId} />
      </div>
    );
  }
  return <p className="chat-message-unsupported">This message type isn&apos;t supported yet.</p>;
}

/** A local file's own preview while it's still going out: dimmed, with a spinner over it. */
function PendingTile({ file }: { file: File }) {
  const kind = attachmentKind(file.type);
  const url = useLocalFileUrl(file, kind !== "file");
  return (
    <div className="chat-attachment-tile pending">
      {kind === "image" && url && <img alt="" src={url} />}
      {kind === "video" && url && <video muted src={url} />}
      {(kind === "file" || !url) && (
        <span className="chat-attachment-pending-name">{file.name}</span>
      )}
      <span aria-hidden="true" className="chat-attachment-pending-spinner" />
    </div>
  );
}

/**
 * An outgoing bubble before the server has it: a dimmed, spinner-over preview of each file,
 * grouped the same way a sent message would be. Shares ChatAttachments's own root class so the
 * same CSS (flush-to-the-edges grid, inset caption/chips) applies to both without duplicating it.
 */
export function PendingContent({
  text,
  files = [],
  preview,
}: {
  text: string;
  files?: File[];
  preview?: LinkPreviewData | null;
}) {
  // A plain text message (no files) skips the .chat-attachments treatment entirely - that class
  // is what strips the bubble's own padding/border, which a text-only bubble still needs.
  if (files.length === 0) {
    if (!text) return null;
    if (!preview) {
      return (
        <p>
          <LinkifiedText text={text} />
        </p>
      );
    }
    return (
      <div className="chat-text-with-preview">
        <p>
          <LinkifiedText text={text} />
        </p>
        <DraftLinkPreviewCard linked preview={preview} />
      </div>
    );
  }

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
