"use client";

import { FiX } from "react-icons/fi";
import { useAttachmentBlobUrl } from "../../hooks/chat/useAttachmentBlobUrl";
import {
  previewDomain,
  previewDomainLine,
  previewImageSrc,
  previewThumbSource,
} from "../../lib/chat/linkPreviewView";
import "./LinkPreview.css";

/** One link preview card: picture, title and description; the site is only named when the link text itself could mislead. */
export function LinkPreviewCardView({ href, domain, resolvedDomain, title, description, imageSrc, onDismiss }) {
  const domainLine = previewDomainLine(domain, resolvedDomain);
  const body = (
    <>
      {imageSrc && <img alt="" className="chat-link-preview-image" src={imageSrc} />}
      <span className="chat-link-preview-text">
        {domainLine && <small className="chat-link-preview-domain">{domainLine}</small>}
        {title && <b className="chat-link-preview-title">{title}</b>}
        {description && <span className="chat-link-preview-description">{description}</span>}
      </span>
    </>
  );

  return (
    <div className="chat-link-preview">
      {href ? (
        <a className="chat-link-preview-body" href={href} rel="noopener noreferrer nofollow" target="_blank">
          {body}
        </a>
      ) : (
        <div className="chat-link-preview-body">{body}</div>
      )}
      {onDismiss && (
        <button aria-label="Remove link preview" className="chat-link-preview-dismiss" onClick={onDismiss} type="button">
          <FiX />
        </button>
      )}
    </div>
  );
}

/** The card inside a received (or sent) message: its picture is decrypted from the message's own attachments. */
export function ReceivedLinkPreviewCard({ preview, messageId, media }) {
  const thumb = useAttachmentBlobUrl(previewThumbSource(messageId, preview, media), true);

  return (
    <LinkPreviewCardView
      description={preview.description}
      domain={previewDomain(preview.url)}
      href={preview.url}
      imageSrc={thumb.status === "ready" ? thumb.url : undefined}
      title={preview.title}
    />
  );
}

/** The card as the server found it, before it has been sent: in the composer and on a message still going out. */
export function DraftLinkPreviewCard({ preview, onDismiss, linked = false }) {
  return (
    <LinkPreviewCardView
      description={preview.description}
      domain={preview.domain}
      href={linked ? preview.url : undefined}
      imageSrc={previewImageSrc(preview.image)}
      onDismiss={onDismiss}
      resolvedDomain={preview.resolvedDomain}
      title={preview.title}
    />
  );
}

/** A reply quote's small, dimmed copy of the quoted message's card: its picture and title. */
export function QuotedLinkPreview({ preview, messageId, media }) {
  const thumb = useAttachmentBlobUrl(previewThumbSource(messageId, preview, media), true);

  return (
    <span className="chat-reply-quote-preview">
      {thumb.status === "ready" && <img alt="" src={thumb.url} />}
      {preview.title && <span className="chat-reply-quote-preview-title">{preview.title}</span>}
    </span>
  );
}
