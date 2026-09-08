import { Injectable, Logger } from '@nestjs/common';
import type {
  InterestDelta,
  PostInterestAction,
  UserInterestProfile,
} from './recommendation.types';
import { UserInterestRepository } from './user-interest.repository';

const ACTION_WEIGHT: Record<PostInterestAction, number> = {
  LIKE: 3,
  UNLIKE: -3,

  COMMENT: 4,
  COMMENT_REMOVE: -4,
};

const AUTHOR_WEIGHT_MULTIPLIER = 0.5;

/**
 * Interest gradually weakens without needing background DB updates.
 */
const INTEREST_DECAY_DAYS = 90;

@Injectable()
export class UserInterestService {
  private readonly logger = new Logger(UserInterestService.name);

  constructor(
    private readonly userInterestRepository: UserInterestRepository,
  ) {}

  /**
   * Recommendation updates are intentionally best-effort.
   *
   * A recommendation write failure must never make a successful Like
   * or Comment appear to fail to the user.
   */
  async recordPostInteraction(
    userId: string,
    postId: string,
    action: PostInterestAction,
  ): Promise<void> {
    try {
      const post =
        await this.userInterestRepository.findPostInterestSource(postId);

      if (!post) {
        return;
      }

      const weight = ACTION_WEIGHT[action];

      const deltas: InterestDelta[] = [
        {
          entityType: 'GAME',
          entityId: post.gameId,
          amount: weight,
        },

        {
          entityType: 'POST_TYPE',
          entityId: post.type,
          amount: weight,
        },

        {
          entityType: 'AUTHOR',
          entityId: post.authorId,
          amount: weight * AUTHOR_WEIGHT_MULTIPLIER,
        },
      ];

      if (post.categoryId) {
        deltas.push({
          entityType: 'CATEGORY',
          entityId: post.categoryId,
          amount: weight,
        });
      }

      /**
       * Split the tag contribution.
       *
       * A post containing 10 tags should not generate 10x more
       * interest than a post containing one meaningful tag.
       */
      if (post.tags.length > 0) {
        const tagWeight = weight / post.tags.length;

        for (const tag of post.tags) {
          deltas.push({
            entityType: 'TAG',
            entityId: tag.tagId,
            amount: tagWeight,
          });
        }
      }

      await this.userInterestRepository.applyDeltas(userId, deltas);
    } catch (error) {
      this.logger.error(
        `Failed to update interests for user ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Returns normalized interests in the 0..1 range.
   *
   * Stored scores are raw accumulated values.
   * The feed ranker should never consume raw values directly.
   */
  async getProfile(userId: string): Promise<UserInterestProfile> {
    const rows = await this.userInterestRepository.findByUserId(userId);

    const games = new Map<string, number>();
    const categories = new Map<string, number>();
    const postTypes = new Map<string, number>();
    const tags = new Map<string, number>();
    const authors = new Map<string, number>();

    for (const row of rows) {
      const score = this.effectiveScore(row.score, row.lastSignalAt);

      if (score <= 0) {
        continue;
      }

      switch (row.entityType) {
        case 'GAME':
          games.set(row.entityId, score);
          break;

        case 'CATEGORY':
          categories.set(row.entityId, score);
          break;

        case 'POST_TYPE':
          postTypes.set(row.entityId, score);
          break;

        case 'TAG':
          tags.set(row.entityId, score);
          break;

        case 'AUTHOR':
          authors.set(row.entityId, score);
          break;
      }
    }

    return {
      games: this.normalize(games),
      categories: this.normalize(categories),
      postTypes: this.normalize(postTypes),
      tags: this.normalize(tags),
      authors: this.normalize(authors),

      hasSignals: rows.length > 0,
    };
  }

  /**
   * log1p limits runaway accumulated scores.
   *
   * Recency decay means:
   * - current interests stay strong;
   * - old interests gradually matter less;
   * - no scheduled UPDATE job is required.
   */
  private effectiveScore(rawScore: number, lastSignalAt: Date) {
    const ageDays = Math.max(
      0,
      (Date.now() - lastSignalAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    const decay = Math.exp(-ageDays / INTEREST_DECAY_DAYS);

    return Math.log1p(rawScore) * decay;
  }

  private normalize(scores: Map<string, number>): Record<string, number> {
    if (scores.size === 0) {
      return {};
    }

    const maxScore = Math.max(...scores.values());

    if (maxScore <= 0) {
      return {};
    }

    return Object.fromEntries(
      [...scores.entries()].map(([id, score]) => [id, score / maxScore]),
    );
  }
}
