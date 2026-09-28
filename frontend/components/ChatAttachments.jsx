"use client";

import { useMemo } from "react";
import { attachmentKind, resolveAttachmentSources } from "../lib/mls/media/attachmentView";
import { AttachmentFileChip } from "./AttachmentFileChip";
import { ImageTile, VideoTile } from "./AttachmentTiles";
import "./ChatAttachments.css";

/** One decrypted attachment envelope: a media grid, then download chips, then the caption. */
export function ChatAttachments({ messageId, envelope, media }) {
  const urlByUploadId = useMemo(
    () => new Map((media || []).map((item) => [item.mediaUploadId, item.url])),
    [media],
  );
  const { visual, others } = useMemo(
    () => resolveAttachmentSources(messageId, envelope.files, urlByUploadId),
    [messageId, envelope.files, urlByUploadId],
  );

  return (
    <div className="chat-attachments">
      {visual.length > 0 && (
        <div className="chat-attachment-grid">
          {visual.map(({ file, index, source, thumbSource }) => {
            const Tile = attachmentKind(file.mime) === "video" ? VideoTile : ImageTile;
            return <Tile file={file} key={index} source={source} thumbSource={thumbSource} />;
          })}
        </div>
      )}
      {others.map(({ file, index, source }) => (
        <AttachmentFileChip file={file} key={index} source={source} />
      ))}
      {envelope.body && <p>{envelope.body}</p>}
    </div>
  );
}
