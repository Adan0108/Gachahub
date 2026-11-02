import {
  economyDay,
  isEstablished,
  nextEconomyDayStart,
  rankFor,
  reputationFromComments,
  reputationFromLikes,
  shardsToCredit,
  trustThresholds,
} from './economy-rules';

describe('economy rules', () => {
  it('starts the day at midnight Vietnam time', () => {
    expect(economyDay(new Date('2026-10-29T16:59:00Z')).toISOString()).toBe(
      '2026-10-29T00:00:00.000Z',
    );
    expect(economyDay(new Date('2026-10-29T17:00:00Z')).toISOString()).toBe(
      '2026-10-30T00:00:00.000Z',
    );
    expect(
      nextEconomyDayStart(new Date('2026-10-29T10:00:00Z')).toISOString(),
    ).toBe('2026-10-29T17:00:00.000Z');
  });

  it('pays likes 1:1 to 100, then 1 per 10 to 1,000, then 1 per 100', () => {
    expect(reputationFromLikes(0)).toBe(0);
    expect(reputationFromLikes(100)).toBe(100);
    expect(reputationFromLikes(109)).toBe(100);
    expect(reputationFromLikes(110)).toBe(101);
    expect(reputationFromLikes(100 + 9000)).toBe(1000);
    expect(reputationFromLikes(100 + 9000 + 99)).toBe(1000);
    expect(reputationFromLikes(100 + 9000 + 100)).toBe(1001);
    expect(reputationFromLikes(1_000_000)).toBe(1000 + 9909);
  });

  it('pays comments 1:1 to 20, then 1 per 5 to 150, then 1 per 20', () => {
    expect(reputationFromComments(20)).toBe(20);
    expect(reputationFromComments(24)).toBe(20);
    expect(reputationFromComments(25)).toBe(21);
    expect(reputationFromComments(20 + 650)).toBe(150);
    expect(reputationFromComments(20 + 650 + 20)).toBe(151);
  });

  it('caps shards per day and spreads a 1.5x multiplier over whole shards', () => {
    expect(shardsToCredit(1, 0)).toBe(1);
    expect(shardsToCredit(61, 60)).toBe(0);
    expect(shardsToCredit(1, 0, 1.5)).toBe(1);
    expect(shardsToCredit(2, 1, 1.5)).toBe(2);
    expect(shardsToCredit(100, 80, 1.5)).toBe(10);
  });

  it('ranks by lifetime reputation, with no decay up to Nova', () => {
    expect(rankFor(0, 0)).toBe('STARGAZER');
    expect(rankFor(999, 999)).toBe('STARGAZER');
    expect(rankFor(1_000, 0)).toBe('METEOR');
    expect(rankFor(4_000, 0)).toBe('COMET');
    expect(rankFor(12_000, 0)).toBe('NOVA');
    expect(rankFor(29_999, 0)).toBe('NOVA');
  });

  it('lets Supernova and Galaxy slip when recent reputation dries up, never below Nova', () => {
    expect(rankFor(30_000, 1_000)).toBe('SUPERNOVA');
    expect(rankFor(30_000, 999)).toBe('NOVA');
    expect(rankFor(75_000, 4_000)).toBe('GALAXY');
    expect(rankFor(75_000, 3_999)).toBe('SUPERNOVA');
    expect(rankFor(75_000, 999)).toBe('NOVA');
    expect(rankFor(75_000, 0)).toBe('NOVA');
  });

  it('gives each account its own thresholds inside the ranges', () => {
    const seen = new Set<number>();
    for (let index = 0; index < 200; index++) {
      const thresholds = trustThresholds('secret', `user-${index}`);
      expect(thresholds.minAgeDays).toBeGreaterThanOrEqual(5);
      expect(thresholds.minAgeDays).toBeLessThanOrEqual(10);
      expect([1, 2]).toContain(thresholds.minPosts);
      expect([3, 4, 5]).toContain(thresholds.minComments);
      seen.add(thresholds.minAgeDays);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(trustThresholds('secret', 'a')).toEqual(
      trustThresholds('secret', 'a'),
    );
  });

  it('counts an account as established only when old, active and has posted', () => {
    const now = new Date('2026-10-29T00:00:00Z');
    const thresholds = { minAgeDays: 7, minPosts: 1, minComments: 3 };
    const old = new Date('2026-10-01T00:00:00Z');
    const base = {
      createdAt: old,
      status: 'ACTIVE',
      postCount: 1,
      commentCount: 0,
    };
    expect(isEstablished(base, thresholds, now)).toBe(true);
    expect(
      isEstablished({ ...base, status: 'SUSPENDED' }, thresholds, now),
    ).toBe(false);
    expect(
      isEstablished(
        { ...base, createdAt: new Date('2026-10-25T00:00:00Z') },
        thresholds,
        now,
      ),
    ).toBe(false);
    expect(
      isEstablished(
        { ...base, postCount: 0, commentCount: 3 },
        thresholds,
        now,
      ),
    ).toBe(true);
    expect(
      isEstablished(
        { ...base, postCount: 0, commentCount: 2 },
        thresholds,
        now,
      ),
    ).toBe(false);
  });
});
