import { BadRequestException } from '@nestjs/common';
import type { ChatParticipantState } from '../../generated/prisma/client';
import type { ParticipantTransition } from './apply-participant-transitions';
import {
  isAnswerToInvite,
  resolveMembershipTransition,
  type MembershipEvent,
} from './membership-state-machine';

/** Events an app-level caller may request; the MLS-only ones come from planCommitTransitions, never from here. */
export type AppMembershipEvent = Exclude<
  MembershipEvent,
  'COMMIT_ADDED' | 'COMMIT_REMOVED' | 'GROUP_ACTIVATED'
>;

export interface MembershipRequest {
  userId: string;
  event: AppMembershipEvent;
}

/** What to do with an event illegal from someone's current state: 'throw' fails the request, 'skip' leaves that person alone. */
export type OnIllegalMembershipChange = 'throw' | 'skip';

interface ParticipantRow {
  userId: string;
  state: ChatParticipantState;
  role: string;
}

/** Pure: decides what each requested membership event does to each person; a change waits for a Commit only when one is needed. */
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
