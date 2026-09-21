import { BadRequestException } from '@nestjs/common';
import type { ChatParticipantState } from '../../generated/prisma/client';
import type { ParticipantTransition } from './apply-participant-transitions';
import {
  resolveMembershipTransition,
  type MembershipEvent,
} from './membership-state-machine';

export interface MembershipRequest {
  userId: string;
  event: MembershipEvent;
}

interface ParticipantRow {
  userId: string;
  state: ChatParticipantState;
  role: string;
}

/**
 * Decides what each requested membership event does to each person, given the
 * conversation as it stands. Pure: the repository reads the facts inside a
 * transaction and applies what this returns.
 *
 * A removal only waits for a Remove Commit when there is a device in the MLS
 * group for that Commit to remove. Someone with none (never got a device in,
 * or the group predates them) has nothing to wait for, so the removal is final
 * at once - otherwise they would sit in LEAVING forever, and LEAVING blocks
 * every send in the group until it is cleared.
 */
export function planMembershipChanges(params: {
  requests: readonly MembershipRequest[];
  participants: readonly ParticipantRow[];
  /** Whether the conversation has an MLS group at all. */
  mlsActive: boolean;
  /** Users who currently have at least one device in the MLS group. */
  userIdsWithLeaves: ReadonlySet<string>;
}): ParticipantTransition[] {
  const { requests, participants, mlsActive, userIdsWithLeaves } = params;
  const participantByUserId = new Map(
    participants.map((participant) => [participant.userId, participant]),
  );
  const changes: ParticipantTransition[] = [];

  for (const { userId, event } of requests) {
    const participant = participantByUserId.get(userId);

    if (participant?.role === 'OWNER' && event === 'REMOVE') {
      continue;
    }

    const removalHasNothingToWaitFor =
      event === 'REMOVE' && !userIdsWithLeaves.has(userId);

    const transition = resolveMembershipTransition({
      from: participant?.state ?? 'NONE',
      event,
      mlsActive: mlsActive && !removalHasNothingToWaitFor,
    });

    if (transition.kind === 'illegal') {
      throw new BadRequestException(illegalMessage(event, participant?.state));
    }

    if (transition.kind === 'change') {
      changes.push({
        userId,
        from: participant?.state ?? null,
        to: transition.to,
      });
    }
  }

  return changes;
}

function illegalMessage(
  event: MembershipEvent,
  state: ChatParticipantState | undefined,
): string {
  if (event === 'ACCEPT_INVITE' || event === 'DECLINE_INVITE') {
    return 'Conversation is not pending';
  }

  if (state === 'LEAVING') {
    return 'This member is still being removed - try again in a moment';
  }

  return `Cannot apply ${event} to a member in state ${state ?? 'NONE'}`;
}
