import { Injectable } from '@nestjs/common';
import { ChatRepository } from './chat.repository';

export interface PublicEmote {
  id: string;
  shortcode: string;
  unicode: string | null;
  imageUrl: string | null;
  animationUrl: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
}

export interface UsableEmotes {
  global: PublicEmote[];
  games: Array<{
    game: { id: string; name: string; slug: string };
    emotes: PublicEmote[];
  }>;
}

/** The emotes a person can react with, laid out the way a picker shows them: global first, then one section per game. */
@Injectable()
export class ChatEmotesService {
  constructor(private readonly chatRepository: ChatRepository) {}

  async listUsable(userId: string): Promise<UsableEmotes> {
    const rows = await this.chatRepository.findUsableChatEmotes(userId);

    const result: UsableEmotes = { global: [], games: [] };
    const byGame = new Map<string, UsableEmotes['games'][number]>();

    for (const row of rows) {
      const emote: PublicEmote = {
        id: row.id,
        shortcode: row.shortcode,
        unicode: row.unicode,
        imageUrl: row.imageUrl,
        animationUrl: row.animationUrl,
        width: row.width,
        height: row.height,
        mimeType: row.mimeType,
      };

      if (row.scope === 'GLOBAL' || !row.game) {
        result.global.push(emote);
        continue;
      }

      let section = byGame.get(row.game.id);
      if (!section) {
        section = { game: row.game, emotes: [] };
        byGame.set(row.game.id, section);
        result.games.push(section);
      }
      section.emotes.push(emote);
    }

    result.games.sort((a, b) => a.game.name.localeCompare(b.game.name));
    return result;
  }
}
