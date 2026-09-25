"use client";

import { useMemo } from "react";
import { attachmentKind, groupAttachments } from "../lib/mls/media/attachmentView";
import { AttachmentFileChip } from "./AttachmentFileChip";
import { ImageTile, VideoTile } from "./AttachmentTiles";
import "./ChatAttachments.css";

function sourceFor({ url, messageId, index, variant, ref, mime, size }) {
  if (!url) return null;
  return { cacheKey: `${messageId}:${index}:${variant}`, url, ref, mime, size };
}

/** One decrypted attachment envelope: a media grid, then download chips, then the caption. */
export function ChatAttachments({ messageId, envelope, media }) {
  const urlByUploadId = useMemo(
    () => new Map((media || []).map((item) => [item.mediaUploadId, item.url])),
    [media],
  );
  const { visual, others } = useMemo(() => groupAttachments(envelope.files), [envelope.files]);

  const withSources = ({ file, index }) => {
    const { thumb } = file;
    return {
      file,
      index,
      source: sourceFor({
        url: urlByUploadId.get(file.blob),
        messageId,
        index,
        variant: "file",
        ref: file,
        mime: file.mime,
        size: file.size,
      }),
      thumbSource: thumb
        ? sourceFor({
            url: urlByUploadId.get(thumb.blob),
            messageId,
            index,
            variant: "thumb",
            ref: thumb,
            mime: "image/jpeg",
          })
        : null,
    };
  };

  return (
    <div className="chat-attachments">
      {visual.length > 0 && (
        <div className="chat-attachment-grid">
          {visual.map(withSources).map(({ file, index, source, thumbSource }) => {
            const Tile = attachmentKind(file.mime) === "video" ? VideoTile : ImageTile;
            return <Tile file={file} key={index} source={source} thumbSource={thumbSource} />;
          })}
        </div>
      )}
      {others.map(withSources).map(({ file, index, source }) => (
        <AttachmentFileChip file={file} key={index} source={source} />
      ))}
      {envelope.body && <p>{envelope.body}</p>}
    </div>
  );
}
