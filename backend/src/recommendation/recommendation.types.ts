import type { InterestEntityType, PostType } from '../generated/prisma/client';

export type PostInteractionAction =
  | 'LIKE'
  | 'UNLIKE'
  | 'COMMENT'
  | 'COMMENT_REMOVE';

export interface InterestDelta {
  entityType: InterestEntityType;
  entityId: string;
  amount: number;
}

export interface UserInterestProfile {
  games: Record<string, number>;
  categories: Record<string, number>;
  postTypes: Partial<Record<PostType, number>>;
  tags: Record<string, number>;
  authors: Record<string, number>;

  hasSignals: boolean;
}
