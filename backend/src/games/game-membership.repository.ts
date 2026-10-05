import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Persists community membership independently of moderator assignments. */
@Injectable()
export class GameMembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves a game without hiding archived memberships from leave operations. */
  findGameBySlug(slug: string) {
    return this.prisma.game.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
  }

  /** Inserts once and increments the displayed count in the same transaction. */
  join(gameId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.gameMember.createMany({
        data: [{ gameId, userId, role: 'MEMBER' }],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        await tx.game.update({
          where: { id: gameId },
          data: { memberCount: { increment: 1 } },
        });
      }
      return { joined: true };
    });
  }

  /** Deletes only this user's membership and clamps legacy zero counts safely. */
  leave(gameId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.gameMember.deleteMany({
        where: { gameId, userId },
      });
      if (removed.count > 0) {
        await tx.game.updateMany({
          where: { id: gameId, memberCount: { gt: 0 } },
          data: { memberCount: { decrement: 1 } },
        });
      }
      return { joined: false };
    });
  }

  /** Returns only whether the authenticated user's membership exists. */
  async status(gameId: string, userId: string) {
    const member = await this.prisma.gameMember.findUnique({
      where: { gameId_userId: { gameId, userId } },
      select: { id: true },
    });
    return { joined: member !== null };
  }

  /** Lists joined, publicly reachable games in stable membership creation order. */
  async list(userId: string) {
    const rows = await this.prisma.gameMember.findMany({
      where: { userId, game: { status: { not: 'ARCHIVED' } } },
      orderBy: [{ createdAt: 'desc' }, { gameId: 'asc' }],
      select: { game: true },
    });
    return rows.map((row) => row.game);
  }
}
