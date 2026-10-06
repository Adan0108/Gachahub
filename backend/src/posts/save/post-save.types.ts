import type { formatPost } from '../post.mapper';
import type { SavedPostRow } from './post-save.repository';

export interface SavePostResponse {
  saved: true;
}

export interface UnsavePostResponse {
  saved: false;
}

export type SavedPostItem = ReturnType<
  typeof formatPost<SavedPostRow['post']>
> & {
  savedAt: Date;
};

export interface SavedPostsResponse {
  items: SavedPostItem[];
  hasMore: boolean;
  nextCursor: string | null;
}
