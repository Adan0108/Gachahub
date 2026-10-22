import { emotesAsText } from "../emoji/emoteText";
import { attachmentKind, envelopeView } from "../mls/media/attachmentView";
import type { AttachmentFile } from "../mls/contract/types";

function attachmentLabel(files: AttachmentFile[]): string {
  if (files.length > 1) return `Sent ${files.length} attachments`;
  const kind = attachmentKind(files[0]?.mime ?? "");
  if (kind === "image") return "Sent a photo";
  if (kind === "video") return "Sent a video";
  return "Sent a file";
}

function previewText(view: NonNullable<ReturnType<typeof envelopeView>>): string {
  if (view.kind === "text") return view.text;
  if (view.kind === "post") return view.caption || "Shared a post";
  return view.caption || attachmentLabel(view.files);
}

/** The one-line text for a decrypted message in the chat list; null when there is nothing readable. */
export function previewLine(envelope: unknown, { mine }: { mine: boolean }): string | null {
  const view = envelopeView(envelope);
  if (!view) return null;

  const text = previewText(view);
  const oneLine = emotesAsText(text).replace(/\s+/g, " ").trim();
  if (!oneLine) return null;

  return mine ? `You: ${oneLine}` : oneLine;
}

/** The line for a message that was unsent. */
export function unsentPreview({ mine }: { mine: boolean }): string {
  return mine ? "You unsent a message" : "Message unsent";
}
