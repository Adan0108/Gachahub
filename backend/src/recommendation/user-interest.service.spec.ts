jest.mock('./user-interest.repository', () => ({
  UserInterestRepository: class {},
}));
import { UserInterestService } from './user-interest.service';

describe('optional game interest signals', () => {
  const repository = {
    findPostInterestSource: jest.fn(),
    applyDeltas: jest.fn(),
  };
  const service = new UserInterestService(repository as never);
  beforeEach(() => jest.clearAllMocks());
  it.each(['LIKE', 'COMMENT'])(
    'keeps author/tag signals without GAME or POST_TYPE for %s',
    async (action) => {
      repository.findPostInterestSource.mockResolvedValue({
        gameId: null,
        type: null,
        categoryId: null,
        authorId: 'author',
        tags: [{ tagId: 'tag' }],
      });
      await service.recordPostInteraction('user', 'personal', action as never);
      expect(repository.applyDeltas).toHaveBeenCalledWith(
        'user',
        expect.arrayContaining([
          expect.objectContaining({ entityType: 'AUTHOR' }),
          expect.objectContaining({ entityType: 'TAG' }),
        ]),
      );
      const deltas = repository.applyDeltas.mock.calls[0][1];
      expect(
        deltas.map((d: { entityType: string }) => d.entityType).sort(),
      ).toEqual(['AUTHOR', 'TAG']);
    },
  );
  it('preserves game and type signals for community posts', async () => {
    repository.findPostInterestSource.mockResolvedValue({
      gameId: 'game',
      type: 'GUIDE',
      categoryId: null,
      authorId: 'author',
      tags: [],
    });
    await service.recordPostInteraction('user', 'community', 'LIKE');
    expect(repository.applyDeltas).toHaveBeenCalledWith(
      'user',
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'GAME', entityId: 'game' }),
        expect.objectContaining({ entityType: 'POST_TYPE', entityId: 'GUIDE' }),
      ]),
    );
  });
});
