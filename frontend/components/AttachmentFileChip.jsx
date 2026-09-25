"use client";

import { useState } from "react";
import { FiDownload, FiFile } from "react-icons/fi";
import { formatBytes } from "../lib/mls/media/attachmentView";
import { saveAttachment } from "../lib/mls/media/saveAttachment";
import "./ChatAttachments.css";

/** Decrypts on click, then saves; the file is never fetched until asked for. */
export function DownloadButton({ source, name }) {
  const [state, setState] = useState("idle");

  const download = async () => {
    setState("busy");
    try {
      await saveAttachment(source, name);
      setState("idle");
    } catch (error) {
      console.warn("Could not download attachment", error);
      setState("error");
    }
  };

  return (
    <>
      <button
        className="chat-attachment-action"
        disabled={!source || state === "busy"}
        onClick={download}
        type="button"
      >
        <FiDownload aria-hidden="true" /> {state === "busy" ? "Decrypting..." : "Download"}
      </button>
      {state === "error" && <span className="chat-attachment-error">File unavailable</span>}
    </>
  );
}

export function AttachmentFileChip({ file, source }) {
  return (
    <div className="chat-attachment-chip">
      <FiFile aria-hidden="true" />
      <span className="chat-attachment-name" title={file.name}>
        {file.name}
      </span>
      <small>{formatBytes(file.size)}</small>
      {source ? (
        <DownloadButton name={file.name} source={source} />
      ) : (
        <span className="chat-attachment-error">File unavailable</span>
      )}
    </div>
  );
}
