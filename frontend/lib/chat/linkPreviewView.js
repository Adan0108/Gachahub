/** The site a link goes to, as the browser will connect to it (a non-latin name shows in its xn-- form, so it cannot pass for another). */
export function previewDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The line under a card's picture naming the site, only when the message's own link text could mislead: a redirect to elsewhere, or a non-latin name. */
export function previewDomainLine(domain, resolvedDomain) {
  if (resolvedDomain && resolvedDomain !== domain) return `${domain} → ${resolvedDomain}`;
  return domain.split(".").some((label) => label.startsWith("xn--")) ? domain : null;
}

/** Where to load a received card's picture from, found among the message's attachments; null when it has none. */
export function previewThumbSource(messageId, preview, media) {
  if (!preview.thumb) return null;

  const url = (media || []).find((item) => item.mediaUploadId === preview.thumb.blob)?.url;
  if (!url) return null;

  return { cacheKey: `${messageId}:link-preview:thumb`, url, ref: preview.thumb, mime: "image/jpeg" };
}

/** A data address for a picture the server just handed over, to show it in the composer before it is sent. */
export function previewImageSrc(image) {
  return image ? `data:${image.mime};base64,${image.data}` : undefined;
}
