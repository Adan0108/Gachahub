import { createHmac } from 'node:crypto';
import type { ReputationRank } from '../generated/prisma/client';

// The numbers behind earning, from docs/plans/economy-and-cosmetics.md section 4. Pure, so they test without a database.

/** Days run on Vietnam time (UTC+7) for everyone, so caps and check-in reset at one moment. */
const ECONOMY_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

export const CHECK_IN_SHARDS = 10;
export const DAILY_SHARD_CAP = 60;
export const SHARDS_PER_COUNTED_INTERACTION = 1;
export const SHARD_PAYING_COMMENTS_PER_DAY = 3;
/** Most Reputation one person can give the same author in a day. */
export const MAX_REPUTATION_PER_GIVER_PER_DAY = 5;
export const LIKE_MILESTONE_SHARDS: ReadonlyMap<number, number> = new Map([
  [10, 5],
  [50, 20],
  [100, 50],
]);
export const RANK_WINDOW_DAYS = 90;

/** The economy day `now` falls in, as midnight UTC of that calendar date (what a Postgres DATE column holds). */
export function economyDay(now: Date): Date {
  const shifted = new Date(now.getTime() + ECONOMY_UTC_OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ),
  );
}

/** When the economy day containing `now` ends. */
export function nextEconomyDayStart(now: Date): Date {
  return new Date(
    economyDay(now).getTime() + 24 * 60 * 60 * 1000 - ECONOMY_UTC_OFFSET_MS,
  );
}

type Step = { upToPoints: number; perPoint: number };

/** Each step pays 1 point per `perPoint` interactions until the total reaches `upToPoints`. */
const LIKE_STEPS: Step[] = [
  { upToPoints: 200, perPoint: 1 },
  { upToPoints: 1000, perPoint: 10 },
  { upToPoints: Infinity, perPoint: 100 },
];
const COMMENT_STEPS: Step[] = [
  { upToPoints: 100, perPoint: 1 },
  { upToPoints: 500, perPoint: 5 },
  { upToPoints: Infinity, perPoint: 20 },
];

function steppedPoints(count: number, steps: Step[]): number {
  let points = 0;
  let left = count;
  for (const step of steps) {
    const room = step.upToPoints - points;
    const fromThisStep = Math.min(room, Math.floor(left / step.perPoint));
    points += fromThisStep;
    left -= fromThisStep * step.perPoint;
    if (fromThisStep < room) break;
  }
  return points;
}

/** Reputation an author has earned from `count` counted likes in one day. */
export function reputationFromLikes(count: number): number {
  return steppedPoints(count, LIKE_STEPS);
}

/** Reputation an author has earned from `count` counted comments in one day. */
export function reputationFromComments(count: number): number {
  return steppedPoints(count, COMMENT_STEPS);
}

/** Shards to credit now, given the day's base earnings; whole numbers only, so ×1.5 evens out over the day. */
export function shardsToCredit(
  baseToday: number,
  creditedToday: number,
  multiplier = 1,
): number {
  const target = Math.min(
    Math.floor(DAILY_SHARD_CAP * multiplier),
    Math.floor(baseToday * multiplier),
  );
  return Math.max(0, target - creditedToday);
}

const RANKS: [number, ReputationRank][] = [
  [10_000, 'GALAXY'],
  [4_000, 'SUPERNOVA'],
  [1_500, 'NOVA'],
  [500, 'COMET'],
  [100, 'METEOR'],
];

export function rankFor(reputation90d: number): ReputationRank {
  return RANKS.find(([min]) => reputation90d >= min)?.[1] ?? 'STARGAZER';
}

export type TrustThresholds = {
  minAgeDays: number;
  minPosts: number;
  minComments: number;
};

/**
 * How established an account must be before its likes and comments earn others anything.
 * Different per account and derived from a server secret, so testing with one bot does not reveal the rule.
 */
export function trustThresholds(
  secret: string,
  userId: string,
): TrustThresholds {
  const digest = createHmac('sha256', secret).update(userId).digest();
  return {
    minAgeDays: 5 + (digest[0] % 6),
    minPosts: 1 + (digest[1] % 2),
    minComments: 3 + (digest[2] % 3),
  };
}

export function isEstablished(
  account: {
    createdAt: Date;
    status: string;
    postCount: number;
    commentCount: number;
  },
  thresholds: TrustThresholds,
  now: Date,
): boolean {
  const ageDays = (now.getTime() - account.createdAt.getTime()) / 86_400_000;
  return (
    account.status === 'ACTIVE' &&
    ageDays >= thresholds.minAgeDays &&
    (account.postCount >= thresholds.minPosts ||
      account.commentCount >= thresholds.minComments)
  );
}
