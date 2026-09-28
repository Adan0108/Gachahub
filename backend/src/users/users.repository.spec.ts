import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { escapeLikePattern, UsersRepository } from './users.repository';

describe('UsersRepository.searchByName', () => {
  const prisma = { user: { findMany: jest.fn(), findFirst: jest.fn() } };
  const repository = new UsersRepository(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  const args = () =>
    (
      prisma.user.findMany.mock.calls[0] as [
        { where: { name: unknown; NOT: unknown }; take: number },
      ]
    )[0];

  it('finds an exact id only when active, not the caller and not blocked either way', async () => {
    await repository.findPickableById('me', 'abc');

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'abc',
        NOT: { id: 'me' },
        status: 'ACTIVE',
        blockedUsers: { none: { blockedId: 'me' } },
        blockedBy: { none: { blockerId: 'me' } },
      },
      select: { id: true, name: true, image: true },
    });
  });

  it('prefix query is case-insensitive, active-only and excludes caller and blocks both ways', async () => {
    await repository.searchByName('me', 'ma', 'prefix', 5);

    expect(args()).toEqual({
      where: {
        id: { not: 'me' },
        status: 'ACTIVE',
        name: { startsWith: 'ma', mode: 'insensitive' },
        blockedUsers: { none: { blockedId: 'me' } },
        blockedBy: { none: { blockerId: 'me' } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 5,
      select: { id: true, name: true, image: true },
    });
  });

  it('contains query excludes prefix matches', async () => {
    await repository.searchByName('me', 'ma', 'contains', 2);

    expect(args().where.name).toEqual({ contains: 'ma', mode: 'insensitive' });
    expect(args().where.NOT).toEqual({
      name: { startsWith: 'ma', mode: 'insensitive' },
    });
    expect(args().take).toBe(2);
  });

  it.each([
    ['50%', '50\\%'],
    ['a_b', 'a\\_b'],
    ['c:\\dir', 'c:\\\\dir'],
    ['plain', 'plain'],
  ])('escapes LIKE wildcards in %s so they match literally', (q, escaped) => {
    expect(escapeLikePattern(q)).toBe(escaped);
  });

  it('sends the escaped text to both the prefix and the contains filter', async () => {
    await repository.searchByName('me', '100%_', 'contains', 3);

    expect(args().where.name).toEqual({
      contains: '100\\%\\_',
      mode: 'insensitive',
    });
    expect(args().where.NOT).toEqual({
      name: { startsWith: '100\\%\\_', mode: 'insensitive' },
    });
  });
});
