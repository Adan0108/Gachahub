import type { Prisma } from '../generated/prisma/client';
import {
  isNotificationMuted,
  notMutedParticipantWhere,
} from './notification-mute';

const now = new Date('2026-10-05T12:00:00.000Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

type Row = { notificationLevel: 'ALL' | 'NOTHING'; mutedUntil: Date | null };

/** Just enough of Prisma's where-matching (OR, NOT, equality, lte) to run the filter against a row; anything else fails loudly. */
function matches(where: Prisma.ChatParticipantWhereInput, row: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return (condition as Prisma.ChatParticipantWhereInput[]).some((branch) =>
        matches(branch, row),
      );
    }
    if (key === 'NOT') {
      return !matches(condition as Prisma.ChatParticipantWhereInput, row);
    }
    if (key !== 'notificationLevel' && key !== 'mutedUntil') {
      throw new Error(`matches() does not understand "${key}"`);
    }

    const value = row[key];
    if (condition !== null && typeof condition === 'object') {
      const { lte } = condition as { lte?: Date };
      if (lte === undefined) {
        throw new Error(
          `matches() does not understand ${JSON.stringify(condition)}`,
        );
      }
      return value instanceof Date && value <= lte;
    }
    return value === condition;
  });
}

const STATES: Row[] = [
  { notificationLevel: 'ALL', mutedUntil: null },
  { notificationLevel: 'ALL', mutedUntil: minutes(-1) },
  { notificationLevel: 'ALL', mutedUntil: minutes(1) },
  { notificationLevel: 'NOTHING', mutedUntil: null },
  { notificationLevel: 'NOTHING', mutedUntil: minutes(-1) },
  { notificationLevel: 'NOTHING', mutedUntil: minutes(1) },
  { notificationLevel: 'NOTHING', mutedUntil: now },
];

describe('isNotificationMuted', () => {
  it('is never muted at level ALL', () => {
    expect(
      isNotificationMuted({ notificationLevel: 'ALL', mutedUntil: null }, now),
    ).toBe(false);
  });

  it('is muted indefinitely at NOTHING with no end time', () => {
    expect(
      isNotificationMuted(
        { notificationLevel: 'NOTHING', mutedUntil: null },
        now,
      ),
    ).toBe(true);
  });

  it('is muted while the end time is still ahead', () => {
    expect(
      isNotificationMuted(
        { notificationLevel: 'NOTHING', mutedUntil: minutes(1) },
        now,
      ),
    ).toBe(true);
  });

  it('is no longer muted once the end time has passed', () => {
    expect(
      isNotificationMuted(
        { notificationLevel: 'NOTHING', mutedUntil: minutes(-1) },
        now,
      ),
    ).toBe(false);
  });

  it('is no longer muted at the exact end time', () => {
    expect(
      isNotificationMuted(
        { notificationLevel: 'NOTHING', mutedUntil: now },
        now,
      ),
    ).toBe(false);
  });
});

describe('notMutedParticipantWhere', () => {
  it.each(STATES)(
    'is the exact inverse of isNotificationMuted for %j',
    (state) => {
      expect(matches(notMutedParticipantWhere(now), state)).toBe(
        !isNotificationMuted(state, now),
      );
    },
  );
});
