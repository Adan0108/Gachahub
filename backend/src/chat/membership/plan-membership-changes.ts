import { BadRequestException } from '@nestjs/common';
import type { ChatParticipantState } from '../../generated/prisma/client';
import type { ParticipantTransition } from './apply-participant-transitions';
import {
  isAnswerToInvite,
  resolveMembershipTransition,
  type MembershipEvent,
} from './membership-state-machine';

export interface MembershipRequest {
  userId: string;
  event: MembershipEvent;
}

/**
 * What to do with a request that makes no sense from someone's current state.
 * 'throw' suits an interactive caller (a 400 back to the user); 'skip' leaves
 * that person alone and carries on with everyone else, for a sweep that read
 * their state a moment ago and can't tell someone changed it in between.
 */
export type OnIllegalMembershipChange = 'throw' | 'skip';

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
 * A change only waits for a Commit when there is one to wait for. Leaving
 * (a transition to LEAVING) needs a Remove Commit only if the person has a device
 * in the MLS group; with none there is nothing to wait for, so it is final at
 * once - otherwise they would sit in LEAVING forever, and LEAVING blocks every
 * send in the group until it is cleared. Joining (a transition to JOINING) needs
 * an Add Commit only if none of their devices is in yet - one may already be
 * there, added while they were still PENDING. Both are read off the transition
 * table's own result, so a new event needs only its row in the table.
 */
export function planMembershipChanges(params: {
  requests: readonly MembershipRequest[];
  participants: readonly ParticipantRow[];
  /** Whether the conversation has an MLS group at all. */
  mlsActive: boolean;
  /** Users who currently have at least one device in the MLS group. */
  userIdsWithLeaves: ReadonlySet<string>;
  onIllegal?: OnIllegalMembershipChange;
}): ParticipantTransition[] {
  const {
    requests,
    participants,
    mlsActive,
    userIdsWithLeaves,
    onIllegal = 'throw',
  } = params;
  const participantByUserId = new Map(
    participants.map((participant) => [participant.userId, participant]),
  );
  const changes: ParticipantTransition[] = [];

  for (const { userId, event } of requests) {
    const participant = participantByUserId.get(userId);

    if (participant?.role === 'OWNER' && event === 'REMOVE') {
      continue;
    }

    const from = participant?.state ?? 'NONE';
    const hasLeaf = userIdsWithLeaves.has(userId);

    let transition = resolveMembershipTransition({ from, event, mlsActive });

    const noCommitNeeded =
      transition.kind === 'change' &&
      ((transition.to === 'LEAVING' && !hasLeaf) ||
        (transition.to === 'JOINING' && hasLeaf));

    if (noCommitNeeded) {
      transition = resolveMembershipTransition({
        from,
        event,
        mlsActive: false,
      });
    }

    if (transition.kind === 'illegal') {
      if (onIllegal === 'skip') continue;

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
  if (isAnswerToInvite(event)) {
    return 'Conversation is not pending';
  }

  if (state === 'LEAVING') {
    return 'This member is still being removed - try again in a moment';
  }

  return `Cannot apply ${event} to a member in state ${state ?? 'NONE'}`;
}
