import type { PostShareEnvelope } from "../contract/types";

const MAX_CAPTION_CHARS = 1000;
const MAX_POST_ID_CHARS = 64;
const POST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Post ids are cuids; this only has to keep a peer's value harmless inside a URL path and a query key. */
export function isPostId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_POST_ID_CHARS &&
    POST_ID_PATTERN.test(value)
  );
}

/** Structural check for a decrypted `post-share` envelope - the sender is a peer, so nothing here is trusted. */
export function isPostShareEnvelope(value: unknown): value is PostShareEnvelope {
  if (!isRecord(value) || value.v !== 1 || value.type !== "post-share") return false;
  if (!isPostId(value.postId)) return false;

  const { body } = value;
  return body === undefined || (typeof body === "string" && body.length <= MAX_CAPTION_CHARS);
}

/** A post to show in the chat, with an optional note from the sender. Only the id travels: each viewer looks the post up themselves. */
export function buildPostShareEnvelope(postId: string, caption?: string): PostShareEnvelope {
  const note = caption?.trim().slice(0, MAX_CAPTION_CHARS);
  return { v: 1, type: "post-share", postId, ...(note ? { body: note } : {}) };
}

/** The in-app address of a post, for opening it from a card or copying it. */
export function postPath(postId: string): string {
  return `/post/${encodeURIComponent(postId)}`;
}
