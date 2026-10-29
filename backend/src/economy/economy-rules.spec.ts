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

  it('pays likes 1:1 to 200, then 1 per 10 to 1,000, then 1 per 100', () => {
    expect(reputationFromLikes(0)).toBe(0);
    expect(reputationFromLikes(200)).toBe(200);
    expect(reputationFromLikes(209)).toBe(200);
    expect(reputationFromLikes(210)).toBe(201);
    expect(reputationFromLikes(200 + 8000)).toBe(1000);
    expect(reputationFromLikes(200 + 8000 + 99)).toBe(1000);
    expect(reputationFromLikes(200 + 8000 + 100)).toBe(1001);
    expect(reputationFromLikes(1_000_000)).toBe(1000 + 9918);
  });

  it('pays comments 1:1 to 100, then 1 per 5 to 500, then 1 per 20', () => {
    expect(reputationFromComments(100)).toBe(100);
    expect(reputationFromComments(104)).toBe(100);
    expect(reputationFromComments(105)).toBe(101);
    expect(reputationFromComments(100 + 2000)).toBe(500);
    expect(reputationFromComments(100 + 2000 + 20)).toBe(501);
  });

  it('caps shards per day and spreads a 1.5x multiplier over whole shards', () => {
    expect(shardsToCredit(1, 0)).toBe(1);
    expect(shardsToCredit(61, 60)).toBe(0);
    expect(shardsToCredit(1, 0, 1.5)).toBe(1);
    expect(shardsToCredit(2, 1, 1.5)).toBe(2);
    expect(shardsToCredit(100, 80, 1.5)).toBe(10);
  });

  it('ranks by reputation in the window', () => {
    expect(rankFor(0)).toBe('STARGAZER');
    expect(rankFor(99)).toBe('STARGAZER');
    expect(rankFor(100)).toBe('METEOR');
    expect(rankFor(4_000)).toBe('SUPERNOVA');
    expect(rankFor(50_000)).toBe('GALAXY');
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
