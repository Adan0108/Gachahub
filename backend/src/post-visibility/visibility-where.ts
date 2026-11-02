import type { Prisma } from '../generated/prisma/client';

/** Live eligibility, including when cached feed IDs are hydrated. */
export function communityAccessWhere(
  userId?: string,
  now = new Date(),
): Prisma.PostWhereInput {
  if (!userId) return {};
  return {
    AND: [
      {
        OR: [
          { gameId: null },
          {
            game: {
              sanctions: {
                none: {
                  subjectId: userId,
                  type: 'COMMUNITY_BAN',
                  status: 'ACTIVE',
                  startsAt: { lte: now },
                  expiresAt: { gt: now },
                },
              },
            },
          },
        ],
      },
    ],
  };
}

// The where-clause form of PostVisibilityService.canView, for list queries that can't call it post-by-post.
export function viewablePostWhere(userId?: string): Prisma.PostWhereInput {
  if (!userId) {
    return { status: 'PUBLISHED', deletedAt: null, visibility: 'PUBLIC' };
  }

  return {
    ...communityAccessWhere(userId),
    status: 'PUBLISHED',
    deletedAt: null,
    OR: [
      { visibility: 'PUBLIC' },
      { visibility: 'FOLLOWERS_ONLY', authorId: userId },
      {
        visibility: 'FOLLOWERS_ONLY',
        author: { followers: { some: { followerId: userId } } },
      },
    ],
  };
}
