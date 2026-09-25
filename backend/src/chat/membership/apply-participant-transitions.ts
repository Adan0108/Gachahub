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

/** pendingSince to write for a state change: stamped on entering PENDING, cleared on leaving it. */
export function pendingSinceChange(
  from: ChatParticipantState | null,
  to: ChatParticipantState,
  now: Date,
): { pendingSince?: Date | null } {
  if (to === 'PENDING') return from === 'PENDING' ? {} : { pendingSince: now };
  return from === 'PENDING' ? { pendingSince: null } : {};
}

/**
 * Applies membership state changes decided by the membership state machine,
 * inside the caller's transaction, all or nothing.
 *
 * Each change is conditional on the state the caller read, so two requests
 * changing the same person at once can't both win with stale assumptions -
 * the loser gets a Conflict and re-reads. Coming back from DECLINED is a
 * fresh start: role resets to MEMBER and the per-user hidden/archived marks
 * clear, as when a member is added again.
 *
 * Shared by the app-side changes (ChatRepository) and the Commit-side ones
 * (MlsHandshakesRepository) so both write participant rows the same way.
 */
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
