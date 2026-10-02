import type { Prisma } from '../generated/prisma/client';

// The where-clause form of PostVisibilityService.canView, for list queries that can't call it post-by-post.
export function viewablePostWhere(userId?: string): Prisma.PostWhereInput {
  if (!userId) {
    return { status: 'PUBLISHED', deletedAt: null, visibility: 'PUBLIC' };
  }

  return {
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
