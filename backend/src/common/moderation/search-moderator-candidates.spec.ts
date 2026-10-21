import { searchModeratorCandidates } from './search-moderator-candidates';
import { caseModeratorWhere } from '../guards/moderation-capabilities';
import type { Prisma } from '../../generated/prisma/client';

describe('moderation identity search', () => {
  const findMany = jest.fn();
  const db = { user: { findMany } } as unknown as Prisma.TransactionClient;
  beforeEach(() => findMany.mockReset());
  it.each(['@r', '@rad', '@radi', '@radiu'])(
    'only performs an exact handle lookup for %s',
    async (q) => {
      findMany.mockResolvedValue([]);
      expect(
        await searchModeratorCandidates(db, caseModeratorWhere(null), q),
      ).toEqual([]);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1,
          where: { AND: [caseModeratorWhere(null), { username: q.slice(1) }] },
        }),
      );
    },
  );
  it('ranks exact bare usernames then bounded display names without username prefixes or private fields', async () => {
    findMany
      .mockResolvedValueOnce([{ id: 'exact' }])
      .mockResolvedValueOnce([{ id: 'name' }]);
    expect(
      await searchModeratorCandidates(
        db,
        caseModeratorWhere('game'),
        ' Radium ',
      ),
    ).toEqual([{ id: 'exact' }, { id: 'name' }]);
    const calls = findMany.mock.calls as Array<[Prisma.UserFindManyArgs]>;
    expect(calls.map(([query]) => query.take)).toEqual([1, 9]);
    for (const [query] of calls)
      expect(query.select).toEqual({
        id: true,
        name: true,
        username: true,
        image: true,
        role: true,
      });
  });
  it('matches @Radium exactly without any display-name fallback', async () => {
    findMany.mockResolvedValue([{ id: 'radium' }]);
    expect(
      await searchModeratorCandidates(db, caseModeratorWhere(null), '@Radium'),
    ).toEqual([{ id: 'radium' }]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [caseModeratorWhere(null), { username: 'radium' }] },
      }),
    );
  });
  it('never runs name fallback once ten results have been collected', async () => {
    findMany
      .mockResolvedValueOnce([{ id: 'exact' }])
      .mockResolvedValueOnce(
        Array.from({ length: 9 }, (_, i) => ({ id: String(i) })),
      );
    expect(
      await searchModeratorCandidates(db, caseModeratorWhere(null), 'radium'),
    ).toHaveLength(10);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
