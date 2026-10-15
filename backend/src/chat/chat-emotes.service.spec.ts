jest.mock('./chat.repository', () => ({ ChatRepository: class {} }));

import { ChatEmotesService } from './chat-emotes.service';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'emote-1',
  scope: 'GLOBAL',
  gameId: null,
  game: null,
  shortcode: 'wave',
  unicode: null,
  imageUrl: 'https://res.cloudinary.com/demo/wave.png',
  animationUrl: null,
  width: 64,
  height: 64,
  fileSize: 1234,
  mimeType: 'image/png',
  createdById: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const gameRow = (id: string, gameName: string, shortcode: string) =>
  row({
    id,
    scope: 'GAME',
    gameId: `game-${gameName}`,
    game: {
      id: `game-${gameName}`,
      name: gameName,
      slug: gameName.toLowerCase(),
    },
    shortcode,
  });

describe('ChatEmotesService', () => {
  const repository = { findUsableChatEmotes: jest.fn() };
  const service = new ChatEmotesService(repository as never);

  beforeEach(() => jest.resetAllMocks());

  it('asks for the emotes this person can use', async () => {
    repository.findUsableChatEmotes.mockResolvedValue([]);

    await service.listUsable('user-1');

    expect(repository.findUsableChatEmotes).toHaveBeenCalledWith('user-1');
  });

  it('gives nothing when there are no emotes', async () => {
    repository.findUsableChatEmotes.mockResolvedValue([]);

    await expect(service.listUsable('user-1')).resolves.toEqual({
      global: [],
      games: [],
    });
  });

  it('puts global emotes in their own list', async () => {
    repository.findUsableChatEmotes.mockResolvedValue([
      row({ id: 'g1' }),
      row({ id: 'g2', shortcode: 'cheer' }),
    ]);

    const result = await service.listUsable('user-1');

    expect(result.global.map((emote) => emote.shortcode)).toEqual([
      'wave',
      'cheer',
    ]);
    expect(result.games).toEqual([]);
  });

  it('groups game emotes into one section per game', async () => {
    repository.findUsableChatEmotes.mockResolvedValue([
      gameRow('a1', 'Zenless', 'bangboo'),
      gameRow('a2', 'Zenless', 'proxy'),
      gameRow('b1', 'Genshin', 'paimon'),
    ]);

    const result = await service.listUsable('user-1');

    expect(result.games.map((section) => section.game.name)).toEqual([
      'Genshin',
      'Zenless',
    ]);
    expect(result.games[1].emotes.map((emote) => emote.shortcode)).toEqual([
      'bangboo',
      'proxy',
    ]);
  });

  it('keeps global and game emotes apart when they arrive mixed', async () => {
    repository.findUsableChatEmotes.mockResolvedValue([
      gameRow('a1', 'Genshin', 'paimon'),
      row({ id: 'g1' }),
    ]);

    const result = await service.listUsable('user-1');

    expect(result.global).toHaveLength(1);
    expect(result.games).toHaveLength(1);
  });

  it('shows only what a picker needs, not who made an emote or when', async () => {
    repository.findUsableChatEmotes.mockResolvedValue([row()]);

    const [emote] = (await service.listUsable('user-1')).global;

    expect(emote).toEqual({
      id: 'emote-1',
      shortcode: 'wave',
      unicode: null,
      imageUrl: 'https://res.cloudinary.com/demo/wave.png',
      animationUrl: null,
      width: 64,
      height: 64,
      mimeType: 'image/png',
    });
    expect(emote).not.toHaveProperty('createdById');
    expect(emote).not.toHaveProperty('deletedAt');
  });

  it('treats a game emote whose game is missing as global rather than dropping it', async () => {
    repository.findUsableChatEmotes.mockResolvedValue([
      row({ scope: 'GAME', game: null }),
    ]);

    const result = await service.listUsable('user-1');

    expect(result.global).toHaveLength(1);
  });
});
