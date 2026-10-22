"use client";

import { useEmotes } from "../../hooks/chat/useEmotes";
import { hasEmotes, splitEmotes } from "../../lib/emoji/emoteText";
import { splitLinks } from "../../lib/chat/linkify";
import { Emote } from "./Emoji";
import type { ChatEmote } from "../../lib/chat/chatReactions";
import type { EmoteRef } from "../../lib/emoji/emoteText";

function Links({ text }: { text: string }) {
  return splitLinks(text).map((segment, index) =>
    segment.href ? (
      <a href={segment.href} key={index} rel="noopener noreferrer nofollow" target="_blank">
        {segment.text}
      </a>
    ) : (
      segment.text
    ),
  );
}

/** Looks the emote up by id; one the viewer cannot use falls back to its `:name:`. */
function EmoteToken({ token, byId }: { token: EmoteRef; byId: Map<string, ChatEmote> }) {
  const emote = byId.get(token.id);
  if (!emote) return <span className="emote-label">{`:${token.shortcode}:`}</span>;
  return <Emote emote={emote} />;
}

/** Split out so the emote list is only asked for when a message actually has an emote in it. */
function TextWithEmotes({ text }: { text: string }) {
  const { library } = useEmotes();
  const byId = new Map(
    [...(library?.global ?? []), ...(library?.games ?? []).flatMap((game: { emotes: ChatEmote[] }) => game.emotes)].map(
      (emote: ChatEmote): [string, ChatEmote] => [emote.id, emote],
    ),
  );

  return splitEmotes(text).map((piece, index) =>
    piece.emote ? (
      <EmoteToken byId={byId} key={index} token={piece.emote} />
    ) : (
      <Links key={index} text={piece.text} />
    ),
  );
}

/** Message text with its web links made clickable and its custom emotes drawn; everything else, markup included, stays plain text. */
export function LinkifiedText({ text }: { text: string }) {
  return hasEmotes(text) ? <TextWithEmotes text={text} /> : <Links text={text} />;
}
