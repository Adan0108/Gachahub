import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SanctionAccessService {
  constructor(private readonly db: PrismaService) {}
  async blockedReaders(userIds: string[]) {
    if (!userIds.length) return new Set<string>();
    const now = new Date();
    const rows = await this.db.moderationSanction.findMany({
      where: {
        subjectId: { in: userIds },
        scope: 'PLATFORM',
        status: 'ACTIVE',
        type: 'PLATFORM_SUSPENSION',
        startsAt: { lte: now },
        expiresAt: { gt: now },
      },
      select: { subjectId: true },
    });
    return new Set(rows.map((row) => row.subjectId));
  }
  async assertAllowed(userId: string, write: boolean, gameId?: string | null) {
    const now = new Date();
    const sanctions = await this.db.moderationSanction.findMany({
      where: {
        subjectId: userId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        AND: [
          { expiresAt: { gt: now } },
          {
            OR: [
              { scope: 'PLATFORM' },
              ...(gameId ? [{ scope: 'COMMUNITY' as const, gameId }] : []),
            ],
          },
        ],
      },
      select: { type: true },
    });
    const blocked = sanctions.some(
      ({ type }) =>
        ['PLATFORM_SUSPENSION', 'COMMUNITY_BAN'].includes(type) ||
        (write && type === 'COMMUNITY_RESTRICTION'),
    );
    if (blocked)
      throw new ForbiddenException({
        code: 'ACCOUNT_RESTRICTED',
        message:
          'Your account is restricted from this action. View your restrictions and appeal at /account/moderation.',
      });
  }
  async routeGame(
    path: string,
    params: Record<string, string>,
    body?: Record<string, unknown>,
    query?: Record<string, unknown>,
  ) {
    const slug =
      params.gameSlug ||
      (path.startsWith('/games/') ? params.slug : undefined) ||
      ((path.startsWith('/moderation/enforcement') || path === '/posts') &&
      typeof query?.gameSlug === 'string'
        ? query.gameSlug
        : undefined);
    if (slug)
      return (
        await this.db.game.findUnique({ where: { slug }, select: { id: true } })
      )?.id;
    const postId =
      params.postId || (path.startsWith('/posts/') ? params.id : undefined);
    if (postId)
      return (
        await this.db.post.findUnique({
          where: { id: postId },
          select: { gameId: true },
        })
      )?.gameId;
    const commentId =
      params.commentId ||
      (path.startsWith('/comments/') ? params.id : undefined);
    if (commentId)
      return (
        await this.db.comment.findUnique({
          where: { id: commentId },
          select: { post: { select: { gameId: true } } },
        })
      )?.post.gameId;
    // Route targets are authoritative. An extra query/body gameId must never
    // bypass a restriction on an existing post/comment.
    const gameId = body?.gameId ?? query?.gameId;
    return typeof gameId === 'string' ? gameId : undefined;
  }
}
