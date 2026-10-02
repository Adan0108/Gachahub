import { ConflictException, NotFoundException } from '@nestjs/common';
jest.mock('../games/games.service', () => ({
  GamesService: class {},
}));

jest.mock('./game-categories.repository', () => ({
  GameCategoriesRepository: class {},
}));

import { GameCategoriesService } from './game-categories.service';

describe('GameCategoriesService', () => {
  const gameCategoriesRepository = {
    findManyByGameId: jest.fn(),
    findByGameIdAndSlug: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  // GamesService.findBySlug already throws NotFoundException for a missing
  // OR non-ACTIVE (soft-deleted) game - this service just has to propagate
  // whatever it does, not re-decide "does this game exist".
  const gamesService = {
    findBySlug: jest.fn(),
  };

  let service: GameCategoriesService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new GameCategoriesService(
      gameCategoriesRepository as any,
      gamesService as any,
    );
  });

  it('propagates GamesService.findBySlug rejecting a missing or archived game', async () => {
    gamesService.findBySlug.mockRejectedValue(
      new NotFoundException('Game not found'),
    );

    await expect(service.findByGameSlug('missing-game', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lists categories for an existing game', async () => {
    gamesService.findBySlug.mockResolvedValue({
      id: 'game-1',
      slug: 'genshin-impact',
    });

    gameCategoriesRepository.findManyByGameId.mockResolvedValue([
      {
        id: 'category-1',
        name: 'Guides',
        slug: 'guides',
      },
    ]);

    const result = await service.findByGameSlug('genshin-impact', {
      isActive: true,
    });

    expect(gameCategoriesRepository.findManyByGameId).toHaveBeenCalledWith(
      'game-1',
      {
        isActive: true,
      },
    );

    expect(result).toEqual([
      {
        id: 'category-1',
        name: 'Guides',
        slug: 'guides',
      },
    ]);
  });

  it('creates category with generated slug', async () => {
    gamesService.findBySlug.mockResolvedValue({
      id: 'game-1',
      slug: 'genshin-impact',
    });

    gameCategoriesRepository.findByGameIdAndSlug.mockResolvedValue(null);
    gameCategoriesRepository.create.mockResolvedValue({
      id: 'category-1',
      name: 'Team Builds',
      slug: 'team-builds',
    });

    await service.create('genshin-impact', {
      name: 'Team Builds',
    });

    expect(gameCategoriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Team Builds',
        slug: 'team-builds',
        game: {
          connect: {
            id: 'game-1',
          },
        },
      }),
    );
  });

  it('rejects duplicate category slug inside the same game', async () => {
    gamesService.findBySlug.mockResolvedValue({
      id: 'game-1',
      slug: 'genshin-impact',
    });

    gameCategoriesRepository.findByGameIdAndSlug.mockResolvedValue({
      id: 'existing-category',
      slug: 'guides',
    });

    await expect(
      service.create('genshin-impact', {
        name: 'Guides',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws when updating a missing category', async () => {
    gameCategoriesRepository.findById.mockResolvedValue(null);

    await expect(
      service.update('missing-category', {
        name: 'New Name',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
