"use client";

import { DraftLinkPreviewCard } from "./LinkPreviewCard";
import "./LinkPreview.css";

/** The card for the link being typed: a placeholder while it loads, then the card with a way to remove it. */
export function LinkPreviewTray({ preview, isLoading, onDismiss }) {
  if (!preview && !isLoading) return null;

  return (
    <div className="chat-link-preview-tray">
      {preview ? (
        <DraftLinkPreviewCard onDismiss={onDismiss} preview={preview} />
      ) : (
        <div aria-label="Loading link preview" className="chat-link-preview-loading" role="status">
          <span />
          <span />
        </div>
      )}
    </div>
  );
}
