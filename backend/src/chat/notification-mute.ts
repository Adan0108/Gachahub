import type { Prisma } from '../generated/prisma/client';

interface MuteState {
  notificationLevel: 'ALL' | 'NOTHING';
  mutedUntil: Date | null;
}

/** The one definition of "muted": NOTHING with no end time, or an end time still ahead. */
export function isNotificationMuted(
  { notificationLevel, mutedUntil }: MuteState,
  now = new Date(),
): boolean {
  return notificationLevel === 'NOTHING' && (!mutedUntil || mutedUntil > now);
}

/** The same rule as a participant filter: everyone who is not muted right now. */
export function notMutedParticipantWhere(
  now = new Date(),
): Prisma.ChatParticipantWhereInput {
  // NOT NOTHING, mirroring isNotificationMuted, so a new level behaves the same in both.
  return {
    OR: [
      { NOT: { notificationLevel: 'NOTHING' } },
      { mutedUntil: { lte: now } },
    ],
  };
}
