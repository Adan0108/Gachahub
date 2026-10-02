import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { UsersRepository } from './users.repository';

describe('UsersRepository.searchByName', () => {
  const prisma = {
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
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

describe('UsersRepository admin moderation', () => {
  const prisma = {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const repository = new UsersRepository(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('filters by status, role, and a case-insensitive name/email search', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await repository.findManyForAdmin({
      status: 'BANNED',
      role: 'USER',
      search: 'ann_',
      page: 2,
      limit: 10,
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'BANNED',
          role: 'USER',
          OR: [
            { name: { contains: 'ann\\_', mode: 'insensitive' } },
            { email: { contains: 'ann\\_', mode: 'insensitive' } },
          ],
        },
        skip: 10,
        take: 10,
      }),
    );
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: {
        status: 'BANNED',
        role: 'USER',
        OR: [
          { name: { contains: 'ann\\_', mode: 'insensitive' } },
          { email: { contains: 'ann\\_', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('updateStatus only writes when the row still matches fromStatus, and returns null otherwise', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.updateStatus(
      prisma as never,
      'user-1',
      'ACTIVE',
      'BANNED',
    );

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', status: 'ACTIVE' },
      data: { status: 'BANNED' },
    });
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('updateStatus returns the updated row when the conditional write succeeds', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      status: 'BANNED',
    });

    const result = await repository.updateStatus(
      prisma as never,
      'user-1',
      'ACTIVE',
      'BANNED',
    );

    expect(result).toEqual({ id: 'user-1', status: 'BANNED' });
  });
});
