"use client";

import { useState } from "react";
import { FiFile } from "react-icons/fi";
import { formatBytes } from "../../lib/mls/media/attachmentView";
import { saveAttachment } from "../../lib/mls/media/saveAttachment";
import type { AttachmentSource } from "../../lib/mls/media/attachmentLoader";
import type { AttachmentFile } from "../../lib/mls/contract/types";
import "./ChatAttachments.css";

/** Decrypts on save; the file is never fetched until asked for. */
function useSaveAttachment(source: AttachmentSource | null | undefined, name: string) {
  const [state, setState] = useState("idle");

  const save = async () => {
    if (!source) return;
    setState("busy");
    try {
      await saveAttachment(source, name);
      setState("idle");
    } catch (error) {
      console.warn("Could not download attachment", error);
      setState("error");
    }
  };

  return { state, save };
}

function fileExtension(name: string) {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name ?? "");
  return match?.[1]?.toUpperCase() ?? "";
}

/** The whole card is the download target: click saves the file, hover greys it. */
export function AttachmentFileChip({
  file,
  source,
}: {
  file: Pick<AttachmentFile, "name" | "size">;
  source?: AttachmentSource | null;
}) {
  const { state, save } = useSaveAttachment(source, file.name);
  const details = [formatBytes(file.size), fileExtension(file.name)].filter(Boolean).join(" · ");
  const status =
    state === "busy"
      ? "Decrypting..."
      : !source || state === "error"
        ? "File unavailable"
        : details;

  return (
    <button
      aria-busy={state === "busy"}
      className="chat-file-card"
      data-state={!source ? "error" : state}
      disabled={!source || state === "busy"}
      onClick={save}
      title={source ? `Download ${file.name}` : file.name}
      type="button"
    >
      <span className="chat-file-card-icon">
        <FiFile aria-hidden="true" />
      </span>
      <span className="chat-file-card-text">
        <span className="chat-file-card-name">{file.name}</span>
        <small>{status}</small>
      </span>
    </button>
  );
}
