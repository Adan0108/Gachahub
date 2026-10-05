import type { UserInterestProfile } from '../recommendation/recommendation.types';
import { FeedRankerService } from './feed-ranker.service';
import type { ForYouFeedCandidate } from './feed.types';

describe('FeedRankerService - For You engagement', () => {
  const now = new Date('2026-10-03T00:00:00.000Z');
  const coldStartProfile: UserInterestProfile = {
    games: {},
    categories: {},
    postTypes: {},
    tags: {},
    authors: {},
    hasSignals: false,
  };
  const personalizedProfile: UserInterestProfile = {
    games: { 'game-1': 1 },
    categories: { 'category-1': 1 },
    postTypes: { GUIDE: 1 },
    tags: { 'tag-1': 1 },
    authors: { 'author-1': 1 },
    hasSignals: true,
  };
  let ranker: FeedRankerService;

  const candidate = (
    id: string,
    weightedEngagement: number,
    overrides: Partial<ForYouFeedCandidate> = {},
  ): ForYouFeedCandidate => ({
    id,
    authorId: 'author-1',
    gameId: 'game-1',
    categoryId: 'category-1',
    type: 'GUIDE',
    createdAt: now,
    reactionCount: weightedEngagement,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    tags: [{ tagId: 'tag-1' }],
    ...overrides,
  });

  const engagementFromColdStartScore = (score: number) => (score - 0.4) / 0.4;

  const scoreForWeightedEngagement = (weightedEngagement: number) => {
    const [ranked] = ranker.rankForYou(
      [candidate(`post-${weightedEngagement}`, weightedEngagement)],
      coldStartProfile,
      new Set(),
    );

    if (!ranked) {
      throw new Error('Expected ranked candidate');
    }

    return engagementFromColdStartScore(ranked.score);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    ranker = new FeedRankerService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a candidate score unchanged when an unrelated viral post enters', () => {
    const postA = candidate('post-a', 56);
    const viralPost = candidate('post-viral', 10_000, {
      authorId: 'author-viral',
    });
    const [alone] = ranker.rankForYou([postA], coldStartProfile, new Set());
    const withViral = ranker
      .rankForYou([postA, viralPost], coldStartProfile, new Set())
      .find((post) => post.id === postA.id);

    expect(alone?.score).toBe(withViral?.score);
  });

  it('maps zero engagement to zero', () => {
    expect(scoreForWeightedEngagement(0)).toBe(0);
  });

  it('preserves reaction, comment, save, and share weights of 1/2/3/4', () => {
    const candidates = [
      candidate('reaction', 0, { reactionCount: 1 }),
      candidate('comment', 0, { commentCount: 1 }),
      candidate('save', 0, { saveCount: 1 }),
      candidate('share', 0, { shareCount: 1 }),
    ];
    const scores = new Map(
      ranker
        .rankForYou(candidates, coldStartProfile, new Set())
        .map((post) => [post.id, engagementFromColdStartScore(post.score)]),
    );

    expect(scores.get('reaction')).toBeCloseTo(1 - Math.exp(-1 / 75), 12);
    expect(scores.get('comment')).toBeCloseTo(1 - Math.exp(-2 / 75), 12);
    expect(scores.get('save')).toBeCloseTo(1 - Math.exp(-3 / 75), 12);
    expect(scores.get('share')).toBeCloseTo(1 - Math.exp(-4 / 75), 12);
  });

  it('is monotonic across representative seed engagement values', () => {
    const values = [0, 1, 17, 56, 93, 179, 233];
    const scores = values.map(scoreForWeightedEngagement);

    for (let index = 1; index < scores.length; index += 1) {
      expect(scores[index]).toBeGreaterThan(scores[index - 1] ?? -1);
    }
  });

  it('stays bounded for representative non-negative engagement values', () => {
    for (const value of [0, 1, 17, 56, 93, 179, 233, 10_000]) {
      const score = scoreForWeightedEngagement(value);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThan(1);
    }
  });

  it('has diminishing returns as engagement increases', () => {
    const firstGain =
      scoreForWeightedEngagement(50) - scoreForWeightedEngagement(0);
    const secondGain =
      scoreForWeightedEngagement(100) - scoreForWeightedEngagement(50);

    expect(firstGain).toBeGreaterThan(secondGain);
  });

  it('matches the expected saturation calibration', () => {
    expect(scoreForWeightedEngagement(75)).toBeCloseTo(0.632, 3);
    expect(scoreForWeightedEngagement(233)).toBeCloseTo(0.955, 3);
  });

  it('keeps personalized final weights unchanged', () => {
    const engagement = 1 - Math.exp(-75 / 75);
    const [ranked] = ranker.rankForYou(
      [candidate('personalized', 75)],
      personalizedProfile,
      new Set(['author-1']),
    );

    expect(ranked?.score).toBeCloseTo(0.45 + engagement * 0.2 + 0.2 + 0.15, 12);
  });

  it('keeps cold-start final weights unchanged', () => {
    const engagement = 1 - Math.exp(-75 / 75);
    const [ranked] = ranker.rankForYou(
      [candidate('cold-start', 75)],
      coldStartProfile,
      new Set(['author-1']),
    );

    expect(ranked?.score).toBeCloseTo(engagement * 0.4 + 0.4 + 0.2, 12);
  });

  it('keeps createdAt DESC then id DESC tie-breaking', () => {
    const older = new Date(now.getTime() - 60_000);
    const ranked = ranker.rankForYou(
      [
        candidate('post-z-older', 0, { createdAt: older }),
        candidate('post-a', 0),
        candidate('post-z', 0),
      ],
      coldStartProfile,
      new Set(),
    );

    expect(ranked.map((post) => post.id)).toEqual([
      'post-z',
      'post-a',
      'post-z-older',
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(ranker.rankForYou([], coldStartProfile, new Set())).toEqual([]);
  });
});
