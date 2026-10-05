"use client";

import { useState } from "react";
import { FiDownload, FiFile } from "react-icons/fi";
import { formatBytes } from "../../lib/mls/media/attachmentView";
import { saveAttachment } from "../../lib/mls/media/saveAttachment";
import "./ChatAttachments.css";

/** Decrypts on save; the file is never fetched until asked for. */
function useSaveAttachment(source, name) {
  const [state, setState] = useState("idle");

  const save = async () => {
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

export function DownloadButton({ source, name }) {
  const { state, save } = useSaveAttachment(source, name);

  return (
    <>
      <button
        className="chat-attachment-action"
        disabled={!source || state === "busy"}
        onClick={save}
        type="button"
      >
        <FiDownload aria-hidden="true" /> {state === "busy" ? "Decrypting..." : "Download"}
      </button>
      {state === "error" && <span className="chat-attachment-error">File unavailable</span>}
    </>
  );
}

function fileExtension(name) {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name ?? "");
  return match ? match[1].toUpperCase() : "";
}

/** The whole card is the download target: click saves the file, hover greys it. */
export function AttachmentFileChip({ file, source }) {
  const { state, save } = useSaveAttachment(source, file.name);
  const details = [formatBytes(file.size), fileExtension(file.name)].filter(Boolean).join(" · ");
  const status =
    state === "busy" ? "Decrypting..." : !source || state === "error" ? "File unavailable" : details;

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
