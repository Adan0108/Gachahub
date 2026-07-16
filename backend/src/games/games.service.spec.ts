import { ConflictException, NotFoundException } from '@nestjs/common';
jest.mock('./games.repository', () => ({
  GamesRepository: class {},
}));

import { GamesService } from './games.service';

describe('GamesService', () => {
  const repository = {
    findMany: jest.fn(),
    count: jest.fn(),
    findBySlug: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  let service: GamesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GamesService(repository as any);
  });

  it('lists games with default pagination', async () => {
    repository.findMany.mockResolvedValue([{ id: 'game-1' }]);
    repository.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(repository.findMany).toHaveBeenCalledWith({
      where: {},
      skip: 0,
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('throws when game slug does not exist', async () => {
    repository.findBySlug.mockResolvedValue(null);

    await expect(service.findBySlug('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('creates game with generated slug', async () => {
    repository.findBySlug.mockResolvedValue(null);
    repository.create.mockResolvedValue({
      id: 'game-1',
      slug: 'genshin-impact',
    });

    await service.create({ name: 'Genshin Impact' }, 'user-1');

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Genshin Impact',
        slug: 'genshin-impact',
        createdBy: 'user-1',
      }),
    );
  });

  it('rejects duplicate game slug', async () => {
    repository.findBySlug.mockResolvedValue({ id: 'existing' });

    await expect(service.create({ name: 'Genshin Impact' })).rejects.toThrow(
      ConflictException,
    );
  });
});
