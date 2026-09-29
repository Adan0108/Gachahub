"use client";

import { useMemo } from "react";
import {
  attachmentKind,
  chunkVisualAttachments,
  resolveAttachmentSources,
} from "../lib/mls/media/attachmentView";
import { AttachmentFileChip } from "./AttachmentFileChip";
import { ImageTile, VideoTile } from "./AttachmentTiles";
import "./ChatAttachments.css";

/** One decrypted attachment envelope: media grid section(s), then download chips, then the caption. */
export function ChatAttachments({ messageId, envelope, media }) {
  const urlByUploadId = useMemo(
    () => new Map((media || []).map((item) => [item.mediaUploadId, item.url])),
    [media],
  );
  const { visual, others } = useMemo(
    () => resolveAttachmentSources(messageId, envelope.files, urlByUploadId),
    [messageId, envelope.files, urlByUploadId],
  );
  // Discord-style: at most 6 attachments share one uniform grid - a 7th spills into its own
  // section below, rendered exactly like a lone image would be on its own.
  const visualGroups = useMemo(() => chunkVisualAttachments(visual), [visual]);

  return (
    <div className="chat-attachments">
      {visualGroups.map((group, groupIndex) => (
        <div className={`chat-attachment-grid count-${group.length}`} key={groupIndex}>
          {group.map(({ file, index, source, thumbSource }) => {
            const Tile = attachmentKind(file.mime) === "video" ? VideoTile : ImageTile;
            return (
              <Tile
                file={file}
                key={index}
                source={source}
                thumbSource={thumbSource}
                uniform={group.length > 1}
              />
            );
          })}
        </div>
      ))}
      {others.map(({ file, index, source }) => (
        <AttachmentFileChip file={file} key={index} source={source} />
      ))}
      {envelope.body && <p>{envelope.body}</p>}
    </div>
  );
}
