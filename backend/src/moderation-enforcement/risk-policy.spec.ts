import {
  computeUserRisk,
  DEFAULT_RISK_POLICY,
  riskPolicy,
  sanctionExpiry,
} from './risk-policy';
const at = new Date('2026-10-30T00:00:00Z');
const incident = (
  id = 'one',
  severity: 'MINOR' | 'MODERATE' | 'SEVERE' | 'CRITICAL' = 'MINOR',
  days = 0,
) => ({
  id,
  severity,
  createdAt: new Date(at.getTime() - days * 86400000),
  reversedAt: null,
});
describe('human-confirmed user risk', () => {
  it('reports and AI evidence are not inputs; no findings means zero risk', () =>
    expect(computeUserRisk([], at)).toMatchObject({
      score: 0,
      tier: 'LOW',
      confirmedIncidents: 0,
    }));
  it('counts a stable incident once regardless of report or sanction count', () =>
    expect(computeUserRisk(Array(10).fill(incident()), at)).toEqual(
      computeUserRisk([incident()], at),
    ));
  it.each(['MINOR', 'MODERATE', 'SEVERE', 'CRITICAL'] as const)(
    'halves %s contribution at its configured half-life',
    (severity) => {
      const before = computeUserRisk([incident('a', severity)], at).factors[0]
        .contribution;
      const after = computeUserRisk(
        [incident('a', severity, DEFAULT_RISK_POLICY[severity].halfLifeDays)],
        at,
      ).factors[0].contribution;
      expect(after).toBeCloseTo(before / 2, 4);
    },
  );
  it('reversed findings and future decisions add no risk', () =>
    expect(
      computeUserRisk(
        [{ ...incident(), reversedAt: at }, incident('future', 'CRITICAL', -1)],
        at,
      ).score,
    ).toBe(0));
  it('caps repeat weight and score, and is independent of input ordering', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      incident(String(i), 'SEVERE', i),
    );
    const result = computeUserRisk(rows, at);
    expect(result).toEqual(computeUserRisk([...rows].reverse(), at));
    expect(Math.max(...result.factors.map((r) => r.repeatMultiplier))).toBe(
      1.5,
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });
  it('does not treat incidents over a year apart as a rapid repeat', () =>
    expect(
      computeUserRisk([incident('old', 'MINOR', 400), incident('new')], at)
        .factors[1].repeatMultiplier,
    ).toBe(1));
  it('allows configured policy while rejecting unsafe values', () => {
    expect(riskPolicy(JSON.stringify(DEFAULT_RISK_POLICY))).toEqual(
      DEFAULT_RISK_POLICY,
    );
    expect(() => riskPolicy('{}')).toThrow();
    expect(() =>
      riskPolicy(
        JSON.stringify({
          ...DEFAULT_RISK_POLICY,
          MINOR: { weight: 0, halfLifeDays: 0 },
        }),
      ),
    ).toThrow();
  });
  it.each([1, 3, 7, 30])('supports a %s day temporary sanction', (days) =>
    expect(
      sanctionExpiry('PLATFORM_SUSPENSION', days, false, at)?.getTime(),
    ).toBe(at.getTime() + days * 86400000),
  );
  it('custom duration requires Admin authority', () => {
    expect(() => sanctionExpiry('PLATFORM_SUSPENSION', 9, false, at)).toThrow();
    expect(sanctionExpiry('PLATFORM_SUSPENSION', 9, true, at)).toBeInstanceOf(
      Date,
    );
  });
  it.each(['PERMANENT_BAN', 'PLATFORM_READ_ONLY', 'INDEFINITE', 'unknown'])(
    'rejects unsupported sanction %s even for Admin',
    (type) => {
      expect(() => sanctionExpiry(type, undefined, true, at)).toThrow();
      expect(() => sanctionExpiry(type, 30, true, at)).toThrow();
    },
  );
  it.each([undefined, null, 0, -1, 31, 365, Infinity, NaN, 1.5])(
    'rejects missing or out-of-range duration %s',
    (days) => {
      for (const type of [
        'COMMUNITY_RESTRICTION',
        'COMMUNITY_BAN',
        'PLATFORM_SUSPENSION',
      ])
        expect(() => sanctionExpiry(type, days as number, true, at)).toThrow();
    },
  );
  it('accepts the Admin custom bounds and rejects operational presets outside MVP policy', () => {
    expect(sanctionExpiry('PLATFORM_SUSPENSION', 1, true, at)?.getTime()).toBe(
      at.getTime() + 86400000,
    );
    expect(sanctionExpiry('PLATFORM_SUSPENSION', 30, true, at)?.getTime()).toBe(
      at.getTime() + 30 * 86400000,
    );
    const previous = process.env.MODERATION_DURATION_DAYS;
    try {
      process.env.MODERATION_DURATION_DAYS = '1,3,7,31';
      expect(() =>
        sanctionExpiry('PLATFORM_SUSPENSION', 31, true, at),
      ).toThrow();
    } finally {
      if (previous === undefined) delete process.env.MODERATION_DURATION_DAYS;
      else process.env.MODERATION_DURATION_DAYS = previous;
    }
  });
  it('a warning never silently becomes a timed sanction', () => {
    expect(sanctionExpiry('WARNING', undefined, false, at)).toBeNull();
    expect(() => sanctionExpiry('WARNING', 1, true, at)).toThrow();
  });
});
