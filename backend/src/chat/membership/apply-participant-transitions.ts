import { ConflictException } from '@nestjs/common';
import type {
  ChatParticipantState,
  Prisma,
} from '../../generated/prisma/client';

export interface ParticipantTransition {
  userId: string;
  /** The state the caller read, or null when there was no row. */
  from: ChatParticipantState | null;
  to: ChatParticipantState;
}

/**
 * The timestamps to write for a state change. pendingSince is stamped on entering PENDING and
 * cleared on leaving it. invitedAt and joinedAt tell a chat what to say: an invite stamps
 * invitedAt and starts over, becoming a member stamps joinedAt (an accept keeps the invite; a
 * direct add was never invited), and a decline or expiry leaves joinedAt empty.
 */
export function pendingSinceChange(
  from: ChatParticipantState | null,
  to: ChatParticipantState,
  now: Date,
): {
  pendingSince?: Date | null;
  invitedAt?: Date | null;
  joinedAt?: Date | null;
} {
  if (to === 'PENDING') {
    return from === 'PENDING'
      ? {}
      : { pendingSince: now, invitedAt: now, joinedAt: null };
  }
  const left = from === 'PENDING' ? { pendingSince: null } : {};
  if (to !== 'ACTIVE' && to !== 'JOINING') return left;
  if (from === 'PENDING') return { ...left, joinedAt: now };
  // Added directly: someone with no row, or back after leaving. Anything else was already a member
  // (JOINING to ACTIVE, a cancelled removal, back from ARCHIVED or BLOCKED), so nothing new happened.
  if (from !== null && from !== 'DECLINED') return left;
  return { ...left, invitedAt: null, joinedAt: now };
}

/** Applies state-machine membership changes in the caller's transaction, each conditional on the state read (a stale read throws Conflict). */
export async function applyParticipantTransitions(
  tx: Prisma.TransactionClient,
  conversationId: string,
  changes: ParticipantTransition[],
): Promise<number> {
  const now = new Date();

  for (const change of changes) {
    const pendingSince = pendingSinceChange(change.from, change.to, now);
    const applied =
      change.from === null
        ? (
            await tx.chatParticipant.createMany({
              data: [
                {
                  conversationId,
                  userId: change.userId,
                  role: 'MEMBER',
                  state: change.to,
                  ...pendingSince,
                },
              ],
              skipDuplicates: true,
            })
          ).count
        : (
            await tx.chatParticipant.updateMany({
              where: {
                conversationId,
                userId: change.userId,
                state: change.from,
              },
              data: {
                state: change.to,
                ...pendingSince,
                ...(change.from === 'DECLINED'
                  ? { role: 'MEMBER', deletedAt: null, archivedAt: null }
                  : {}),
              },
            })
          ).count;

    if (applied === 0) {
      throw new ConflictException(
        'Membership changed while this request was running - please retry',
      );
    }
  }

  return changes.length;
}
