export interface FeedMeta {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  personalized?: boolean;
}

export interface FeedResponse<T> {
  items: T[];
  meta: FeedMeta;
}

export interface ForYouFeedMeta extends FeedMeta {
  personalized: boolean;
}
