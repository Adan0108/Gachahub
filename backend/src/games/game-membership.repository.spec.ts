jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import type { PrismaService } from '../prisma/prisma.service';
import { GameMembershipRepository } from './game-membership.repository';

describe('GameMembershipRepository', () => {
  let members: Set<string>;
  let memberCount: number;
  const tx = {
    gameMember: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    game: { update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn() };
  const repository = new GameMembershipRepository(
    prisma as unknown as PrismaService,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    members = new Set();
    memberCount = 0;
    prisma.$transaction.mockImplementation(
      async (operation: (db: typeof tx) => Promise<unknown>) => operation(tx),
    );
    tx.gameMember.createMany.mockImplementation(
      ({ data }: { data: Array<{ gameId: string; userId: string }> }) => {
        const key = data[0].gameId + ':' + data[0].userId;
        if (members.has(key)) return { count: 0 };
        members.add(key);
        return { count: 1 };
      },
    );
    tx.gameMember.deleteMany.mockImplementation(
      ({ where }: { where: { gameId: string; userId: string } }) => ({
        count: members.delete(where.gameId + ':' + where.userId) ? 1 : 0,
      }),
    );
    tx.game.update.mockImplementation(() => {
      memberCount++;
      return {};
    });
    tx.game.updateMany.mockImplementation(() => {
      if (memberCount > 0) memberCount--;
      return { count: 1 };
    });
  });

  it('joins once, always as MEMBER, and increments once across duplicate requests', async () => {
    expect(await repository.join('game', 'me')).toEqual({ joined: true });
    expect(await repository.join('game', 'me')).toEqual({ joined: true });
    expect(members.size).toBe(1);
    expect(memberCount).toBe(1);
    expect(tx.gameMember.createMany).toHaveBeenCalledWith({
      data: [{ gameId: 'game', userId: 'me', role: 'MEMBER' }],
      skipDuplicates: true,
    });
    expect(tx.game.update).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('removes only the caller, and repeated leaves decrement once', async () => {
    await repository.join('game', 'me');
    await repository.join('game', 'other');
    await repository.leave('game', 'me');
    await repository.leave('game', 'me');
    expect([...members]).toEqual(['game:other']);
    expect(memberCount).toBe(1);
    expect(tx.game.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.game.updateMany).toHaveBeenCalledWith({
      where: { id: 'game', memberCount: { gt: 0 } },
      data: { memberCount: { decrement: 1 } },
    });
  });

  it('does not decrement an already-zero legacy count', async () => {
    members.add('game:me');
    await repository.leave('game', 'me');
    expect(memberCount).toBe(0);
    expect(members.size).toBe(0);
  });

  it('uses one transaction for each membership/count operation', async () => {
    tx.game.update.mockRejectedValueOnce(new Error('count failed'));
    await expect(repository.join('game', 'me')).rejects.toThrow('count failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.gameMember.createMany).toHaveBeenCalledTimes(1);
  });

  it('reads false/true status without exposing membership fields', async () => {
    tx.gameMember.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'membership' });
    expect(await repository.status('game', 'me')).toEqual({ joined: false });
    expect(await repository.status('game', 'me')).toEqual({ joined: true });
    expect(tx.gameMember.findUnique).toHaveBeenCalledWith({
      where: { gameId_userId: { gameId: 'game', userId: 'me' } },
      select: { id: true },
    });
  });

  it('lists caller memberships with deterministic ordering and excludes archived games', async () => {
    tx.gameMember.findMany.mockResolvedValue([{ game: { id: 'g' } }]);
    expect(await repository.list('me')).toEqual([{ id: 'g' }]);
    expect(tx.gameMember.findMany).toHaveBeenCalledWith({
      where: { userId: 'me', game: { status: { not: 'ARCHIVED' } } },
      orderBy: [{ createdAt: 'desc' }, { gameId: 'asc' }],
      select: { game: true },
    });
  });
});
