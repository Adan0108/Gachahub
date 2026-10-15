import type { ChatEmote, ReactionChoice } from "../chat/chatReactions";

export interface EmoteLibrary {
  global: ChatEmote[];
  games: { game: { id: string; name: string }; emotes: ChatEmote[] }[];
}

/** One custom emoji in the shape the picker takes. */
interface PickerEmoji {
  id: string;
  name: string;
  keywords: string[];
  skins: { src: string }[];
}

export interface PickerCategory {
  id: string;
  name: string;
  emojis: PickerEmoji[];
}

export interface CustomEmojiSet {
  categories: PickerCategory[];
  byId: Map<string, ChatEmote>;
}

/** What the picker hands back: a unicode emoji has `native`, a custom one only its id. */
export interface PickerSelection {
  id?: string;
  native?: string;
}

function toCategory(id: string, name: string, emotes: ChatEmote[], byId: Map<string, ChatEmote>) {
  const emojis: PickerEmoji[] = [];

  for (const emote of emotes) {
    // A static picture for the grid; an emote with only a unicode form is just an emoji, the picker has it already
    const src = emote.imageUrl ?? emote.animationUrl;
    if (!src) continue;
    byId.set(emote.id, emote);
    emojis.push({
      id: emote.id,
      name: emote.shortcode,
      keywords: [emote.shortcode],
      skins: [{ src }],
    });
  }

  return emojis.length ? { id, name, emojis } : null;
}

/** The picker's custom categories (app-wide first, then one per game) and a lookup to map a pick back to its emote. */
export function buildCustomEmoji(library: EmoteLibrary | undefined): CustomEmojiSet {
  const byId = new Map<string, ChatEmote>();
  const categories: PickerCategory[] = [];
  if (!library) return { categories, byId };

  const everyone = toCategory("gachahub", "GachaHub", library.global, byId);
  if (everyone) categories.push(everyone);

  for (const { game, emotes } of library.games) {
    const category = toCategory(`game-${game.id}`, game.name, emotes, byId);
    if (category) categories.push(category);
  }

  return { categories, byId };
}

/** The reaction a picker selection stands for, or null when it is a custom emoji we no longer know. */
export function choiceFromSelection(
  selection: PickerSelection,
  byId: Map<string, ChatEmote>,
): ReactionChoice | null {
  if (selection.native) return { kind: "emoji", emoji: selection.native };

  const emote = selection.id ? byId.get(selection.id) : undefined;
  return emote ? { kind: "emote", emote } : null;
}
