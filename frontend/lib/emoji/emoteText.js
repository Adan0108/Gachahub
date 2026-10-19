const TOKEN = /<:([A-Za-z0-9_]{1,32}):([A-Za-z0-9_-]{8,40})>/g;
const NAMED = /:([A-Za-z0-9_]{1,32}):/g;

/** What is stored in a message for a custom emote: its name for reading, its id for finding it. */
export function emoteToken(emote) {
  return `<:${emote.shortcode}:${emote.id}>`;
}

/** The text with each `:name:` of a picked emote swapped for its token; `emotesByName` maps name to emote. */
export function encodeEmotes(text, emotesByName) {
  if (emotesByName.size === 0) return text;
  return text.replace(NAMED, (whole, name) => {
    const emote = emotesByName.get(name);
    return emote ? emoteToken(emote) : whole;
  });
}

/** The text cut into plain pieces and emote tokens, in order. */
export function splitEmotes(text) {
  const pieces = [];
  let from = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > from) pieces.push({ text: text.slice(from, match.index) });
    pieces.push({ emote: { shortcode: match[1], id: match[2] } });
    from = match.index + match[0].length;
  }
  if (from < text.length) pieces.push({ text: text.slice(from) });
  return pieces;
}

export function hasEmotes(text) {
  return text.includes("<:") && splitEmotes(text).some((piece) => piece.emote);
}

/** Tokens as `:name:`, for places that only show text, such as the chat list. */
export function emotesAsText(text) {
  return text.replace(TOKEN, ":$1:");
}
