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
 * What a state change means for the membership rounds a chat shows: an invite starts a round, an
 * accept finishes the invite's round, and a direct add starts a round already joined. Anything
 * else was already a member (JOINING to ACTIVE, a cancelled removal, back from ARCHIVED or
 * BLOCKED) or is a decline, expiry or leave, which the round needs no stamp for.
 */
export function roundChange(
  from: ChatParticipantState | null,
  to: ChatParticipantState,
): 'invite' | 'accept' | 'join' | null {
  if (to === 'PENDING') return from === 'PENDING' ? null : 'invite';
  if (to !== 'ACTIVE' && to !== 'JOINING') return null;
  if (from === 'PENDING') return 'accept';
  return from === null || from === 'DECLINED' ? 'join' : null;
}

/** The round a new participant row starts with, as a nested create. */
export function firstRound(state: ChatParticipantState, now: Date) {
  const change = roundChange(null, state);
  if (!change) return {};
  return {
    rounds: {
      create: change === 'invite' ? { invitedAt: now } : { joinedAt: now },
    },
  };
}

async function recordRound(
  tx: Prisma.TransactionClient,
  conversationId: string,
  userId: string,
  change: ReturnType<typeof roundChange>,
  now: Date,
) {
  if (!change) return;
  if (change === 'accept') {
    const latest = await tx.chatMembershipRound.findFirst({
      where: { conversationId, userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, invitedAt: true, joinedAt: true },
    });
    if (latest?.invitedAt && !latest.joinedAt) {
      await tx.chatMembershipRound.update({
        where: { id: latest.id },
        data: { joinedAt: now },
      });
      return;
    }
  }
  await tx.chatMembershipRound.create({
    data: {
      conversationId,
      userId,
      createdAt: now,
      ...(change === 'invite' ? { invitedAt: now } : { joinedAt: now }),
    },
  });
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
                ...(change.from === 'DECLINED' ||
                (change.from === 'LEAVING' && change.to === 'PENDING')
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

    await recordRound(
      tx,
      conversationId,
      change.userId,
      roundChange(change.from, change.to),
      now,
    );
  }

  return changes.length;
}
