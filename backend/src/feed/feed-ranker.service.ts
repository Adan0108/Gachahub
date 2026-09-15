import { Injectable } from '@nestjs/common';
import type {
  RankedFeedCandidate,
  TrendingFeedCandidate,
  RankedForYouFeedCandidate,
  ForYouFeedCandidate,
} from './feed.types';
import type { UserInterestProfile } from '../recommendation/recommendation.types';

const FOLLOWING_LATEST_BOOST_HOURS = 1.5;

@Injectable()
export class FeedRankerService {
  /**
   * Latest stays primarily chronological.
   *
   * Followed authors only receive a small boost.
   *
   * A 1.5 hour boost means:
   * a followed post can behave approximately as if
   * it were posted 1.5 hours more recently.
   *
   * This ranking is only performed inside the
   * already selected chronological page.
   */
  rankLatestPage<
    T extends {
      authorId: string;
      createdAt: Date;
    },
  >(posts: T[], followedAuthorIds: Set<string>): T[] {
    return [...posts].sort((a, b) => {
      const aScore = this.latestScore(a, followedAuthorIds);

      const bScore = this.latestScore(b, followedAuthorIds);

      if (aScore !== bScore) {
        return bScore - aScore;
      }

      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  rankTrending(candidates: TrendingFeedCandidate[]): RankedFeedCandidate[] {
    return candidates
      .map((candidate) => ({
        id: candidate.id,

        score: this.trendingScore(candidate),
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Calculates the personalized score for each For You candidate.
   *
   * Personalized users are ranked using:
   * - interest match
   * - engagement
   * - freshness
   * - social relationship
   *
   * Cold-start users without interest signals fall back to
   * engagement, freshness, and social signals.
   *
   * Engagement is normalized within the current candidate pool so
   * raw engagement counts do not dominate the other 0..1 signals.
   */
  rankForYou(
    candidates: ForYouFeedCandidate[],
    profile: UserInterestProfile,
    followedAuthorIds: Set<string>,
  ): RankedForYouFeedCandidate[] {
    if (candidates.length === 0) {
      return [];
    }

    const engagementScores = candidates.map((candidate) =>
      this.rawEngagement(candidate),
    );

    const maxEngagement = Math.max(1, ...engagementScores);

    return candidates
      .map((candidate, index) => {
        const interest = profile.hasSignals
          ? this.interestScore(candidate, profile)
          : 0;

        const engagement = engagementScores[index] / maxEngagement;

        const freshness = this.freshnessScore(candidate.createdAt);

        const social = followedAuthorIds.has(candidate.authorId) ? 1 : 0;

        const score = profile.hasSignals
          ? interest * 0.45 + engagement * 0.2 + freshness * 0.2 + social * 0.15
          : engagement * 0.4 + freshness * 0.4 + social * 0.2;

        return {
          ...candidate,
          score,
        };
      })
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }

        const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();

        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }

        return b.id.localeCompare(a.id);
      });
  }

  /**
   * Reorders ranked candidates to reduce repetitive feed results.
   *
   * The ranking score is preserved as much as possible, but a lower-ranked
   * candidate may be moved forward when the next highest-ranked candidate
   * would violate the feed diversity rules.
   *
   * If no candidate satisfies the diversity rule, the highest-ranked
   * remaining candidate is used so content is never dropped.
   */
  diversifyForYou(ranked: RankedForYouFeedCandidate[]) {
    const remaining = [...ranked];
    const result: RankedForYouFeedCandidate[] = [];

    while (remaining.length > 0) {
      let index = remaining.findIndex((candidate) =>
        this.canAppendCandidate(result, candidate),
      );

      if (index === -1) {
        index = 0;
      }

      const [selected] = remaining.splice(index, 1);

      result.push(selected);
    }

    return result;
  }

  private latestScore(
    post: {
      authorId: string;
      createdAt: Date;
    },
    followedAuthorIds: Set<string>,
  ) {
    const ageHours = Math.max(
      0,
      (Date.now() - post.createdAt.getTime()) / (1000 * 60 * 60),
    );

    const socialBoost = followedAuthorIds.has(post.authorId)
      ? FOLLOWING_LATEST_BOOST_HOURS
      : 0;

    /*
     * Newer = better.
     *
     * Follow simply subtracts a small amount
     * from the effective post age.
     */
    return -ageHours + socialBoost;
  }

  private trendingScore(post: TrendingFeedCandidate) {
    const engagement =
      post.reactionCount +
      post.commentCount * 2 +
      post.saveCount * 3 +
      post.shareCount * 4;

    const ageHours = Math.max(
      1,
      (Date.now() - post.createdAt.getTime()) / (1000 * 60 * 60),
    );

    /*
     * Engagement grows logarithmically so huge posts
     * do not completely dominate forever.
     *
     * Age decay makes old posts naturally fall.
     */
    return Math.log1p(engagement) / Math.pow(ageHours + 2, 0.35);
  }

  /**
   * Calculates how strongly this post matches the user's interest profile.
   *
   * The score combines structured preference signals from:
   * - game
   * - category
   * - post type
   * - tags
   * - author
   *
   * Only the two strongest matching tags are averaged so posts with many tags
   * do not gain an unfair advantage simply because they contain more tags.
   */
  private interestScore(
    post: ForYouFeedCandidate,
    profile: UserInterestProfile,
  ) {
    const game = profile.games[post.gameId] ?? 0;

    const category = post.categoryId
      ? (profile.categories[post.categoryId] ?? 0)
      : 0;

    const postType = profile.postTypes[post.type] ?? 0;

    const author = profile.authors[post.authorId] ?? 0;

    const strongestTags = post.tags
      .map((tag) => profile.tags[tag.tagId] ?? 0)
      .filter((score) => score > 0)
      .sort((a, b) => b - a)
      .slice(0, 2);

    const tags =
      strongestTags.length > 0
        ? strongestTags.reduce((sum, score) => sum + score, 0) /
          strongestTags.length
        : 0;

    return (
      game * 0.3 + category * 0.25 + postType * 0.1 + tags * 0.2 + author * 0.15
    );
  }

  /**
   * Calculates the post's raw engagement strength.
   *
   * Higher-intent interactions receive larger weights:
   * reaction < comment < save < share.
   *
   * log1p compresses large engagement values so viral posts
   * do not dominate the recommendation score.
   */
  private rawEngagement(post: ForYouFeedCandidate) {
    const engagement =
      post.reactionCount +
      post.commentCount * 2 +
      post.saveCount * 3 +
      post.shareCount * 4;

    return Math.log1p(engagement);
  }

  /**
   * Applies exponential time decay to newer content.
   *
   * A post starts near 1.0 and gradually loses freshness as it gets older.
   * The 96-hour constant controls how quickly freshness decays.
   */
  private freshnessScore(createdAt: Date) {
    const ageHours = Math.max(
      0,
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60),
    );

    return Math.exp(-ageHours / 96);
  }

  /**
   * Checks whether a candidate can be appended without making
   * the feed too repetitive.
   *
   * Current diversity rules:
   * - do not show two consecutive posts from the same author
   * - do not show more than three consecutive posts from the same game
   */
  private canAppendCandidate(
    current: RankedForYouFeedCandidate[],
    candidate: RankedForYouFeedCandidate,
  ) {
    const previous = current[current.length - 1];

    if (previous?.authorId === candidate.authorId) {
      return false;
    }

    if (current.length >= 3) {
      const lastThree = current.slice(-3);

      if (lastThree.every((item) => item.gameId === candidate.gameId)) {
        return false;
      }
    }

    return true;
  }
}
