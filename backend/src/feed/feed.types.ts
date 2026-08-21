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
