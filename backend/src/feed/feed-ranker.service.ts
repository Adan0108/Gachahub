import { Injectable } from '@nestjs/common';
import type { RankedFeedCandidate, TrendingFeedCandidate } from './feed.types';

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
}
