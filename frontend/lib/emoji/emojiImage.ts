// Our own origin: a third-party host would see who is reading the chat (copied at build, scripts/copy-emoji-svg.mjs).
export const EMOJI_IMAGE_BASE = "/emoji/svg";

const ZERO_WIDTH_JOINER = "‍";
const VARIATION_SELECTOR_16 = /️/g;

/** The file name an emoji's picture is stored under: its code points in hex, joined with dashes. */
export function emojiFileName(emoji: string): string {
  // The picture set drops the "show as emoji" selector, except inside a joined sequence where it is part of the name
  const normalised = emoji.includes(ZERO_WIDTH_JOINER)
    ? emoji
    : emoji.replace(VARIATION_SELECTOR_16, "");
  return Array.from(normalised, (char) => char.codePointAt(0)!.toString(16)).join("-");
}

export function emojiImageUrl(emoji: string): string {
  return `${EMOJI_IMAGE_BASE}/${emojiFileName(emoji)}.svg`;
}
