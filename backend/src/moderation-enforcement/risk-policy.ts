import type { ViolationSeverity } from '../generated/prisma/client';

export type RiskPolicy = Record<
  ViolationSeverity,
  { weight: number; halfLifeDays: number }
>;
// Slow decay retains serious incidents longer. Reports and sanctions never add points.
export const DEFAULT_RISK_POLICY: RiskPolicy = {
  MINOR: { weight: 5, halfLifeDays: 120 },
  MODERATE: { weight: 15, halfLifeDays: 240 },
  SEVERE: { weight: 35, halfLifeDays: 365 },
  CRITICAL: { weight: 60, halfLifeDays: 540 },
};
export function riskPolicy(
  raw = process.env.MODERATION_RISK_POLICY_JSON,
): RiskPolicy {
  if (!raw) return DEFAULT_RISK_POLICY;
  const parsed = JSON.parse(raw) as RiskPolicy;
  if (
    Object.keys(parsed).length !== 4 ||
    Object.keys(DEFAULT_RISK_POLICY).some((key) => {
      const value = parsed[key as ViolationSeverity];
      return (
        !value ||
        !Number.isFinite(value.weight) ||
        value.weight <= 0 ||
        value.weight > 100 ||
        !Number.isFinite(value.halfLifeDays) ||
        value.halfLifeDays < 30 ||
        value.halfLifeDays > 3650
      );
    })
  )
    throw new Error('Invalid MODERATION_RISK_POLICY_JSON');
  return parsed;
}
type Incident = {
  id: string;
  severity: ViolationSeverity;
  createdAt: Date;
  reversedAt: Date | null;
};
export function computeUserRisk(
  incidents: readonly Incident[],
  at: Date,
  policy = riskPolicy(),
) {
  const time = at.getTime();
  if (!Number.isFinite(time))
    throw new Error('Risk evaluation requires a valid time');
  const unique = [...new Map(incidents.map((row) => [row.id, row])).values()]
    .filter((row) => !row.reversedAt && row.createdAt.getTime() <= time)
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  let start = 0;
  const factors = unique.map((row, index) => {
    while (
      unique[start] &&
      row.createdAt.getTime() - unique[start].createdAt.getTime() >
        365 * 86400000
    )
      start++;
    const elapsedDays = (time - row.createdAt.getTime()) / 86400000;
    const repeatMultiplier = 1 + Math.min(index - start, 5) * 0.1;
    const settings = policy[row.severity];
    const contribution =
      settings.weight *
      repeatMultiplier *
      2 ** (-elapsedDays / settings.halfLifeDays);
    return {
      violationId: row.id,
      severity: row.severity,
      elapsedDays: Math.floor(elapsedDays),
      halfLifeDays: settings.halfLifeDays,
      repeatMultiplier,
      contribution: Math.round(contribution * 10000) / 10000,
    };
  });
  const total = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  const score = Math.round(10000 * (1 - Math.exp(-total / 100))) / 100;
  const tier =
    score >= 65
      ? 'CRITICAL'
      : score >= 35
        ? 'HIGH'
        : score >= 10
          ? 'ELEVATED'
          : 'LOW';
  return {
    score,
    tier,
    evaluatedAt: at.toISOString(),
    confirmedIncidents: unique.length,
    factors,
    explanation: unique.length
      ? `Based on ${unique.length} independent confirmed ${unique.length === 1 ? 'violation' : 'violations'}, their severity, recency and repeat history. Reversed findings and report volume add no points.`
      : 'No effective confirmed violations. Reports alone do not increase this risk.',
    policy: {
      version: 'user-risk-v1',
      scoreRange: [0, 100],
      repeatWindowDays: 365,
      maximumRepeatMultiplier: 1.5,
      severities: policy,
    },
  };
}

export const SANCTION_DURATION_PRESETS = [1, 3, 7, 30] as const;
export const MAX_SANCTION_DAYS = 30;
export const TEMPORARY_SANCTION_TYPES = [
  'COMMUNITY_RESTRICTION',
  'COMMUNITY_BAN',
  'PLATFORM_SUSPENSION',
] as const;

export function durationPolicy() {
  const values = [
    ...new Set(
      (process.env.MODERATION_DURATION_DAYS || '1,3,7,30')
        .split(',')
        .map(Number),
    ),
  ].sort((a, b) => a - b);
  if (
    values.length !== SANCTION_DURATION_PRESETS.length ||
    values.some((value, index) => value !== SANCTION_DURATION_PRESETS[index])
  )
    throw new Error(
      'MODERATION_DURATION_DAYS must contain the MVP presets 1,3,7,30',
    );
  return [...SANCTION_DURATION_PRESETS];
}

export function sanctionExpiry(
  type: string,
  durationDays: number | undefined,
  admin: boolean,
  now: Date,
) {
  if (type === 'WARNING') {
    if (durationDays !== undefined)
      throw new Error(
        'A formal warning does not restrict access or have a duration',
      );
    return null;
  }
  if (
    !TEMPORARY_SANCTION_TYPES.includes(
      type as (typeof TEMPORARY_SANCTION_TYPES)[number],
    )
  )
    throw new Error('Only temporary MVP sanctions are supported');
  if (!Number.isFinite(now.getTime()))
    throw new Error('A valid sanction start is required');
  const allowed = durationPolicy();
  if (
    !Number.isInteger(durationDays) ||
    !durationDays ||
    durationDays < 1 ||
    durationDays > MAX_SANCTION_DAYS ||
    (!admin && !allowed.includes(durationDays as (typeof allowed)[number]))
  )
    throw new Error(
      'Choose 1, 3, 7 or 30 days; Admin custom durations must be between 1 and 30 days',
    );
  return new Date(now.getTime() + durationDays * 86400000);
}
