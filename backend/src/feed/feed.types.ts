import type { PostType } from '../generated/prisma/client';

export interface TrendingFeedCandidate {
  id: string;

  createdAt: Date;

  reactionCount: number;
  commentCount: number;
  saveCount: number;
  shareCount: number;
}

export interface RankedFeedCandidate {
  id: string;
  score: number;
}

export interface ForYouFeedCandidate {
  id: string;

  authorId: string;
  gameId: string;
  categoryId: string | null;

  type: PostType;

  createdAt: Date;

  reactionCount: number;
  commentCount: number;
  saveCount: number;

  shareCount: number;

  tags: Array<{
    tagId: string;
  }>;
}

export interface RankedForYouFeedCandidate extends ForYouFeedCandidate {
  score: number;
}
