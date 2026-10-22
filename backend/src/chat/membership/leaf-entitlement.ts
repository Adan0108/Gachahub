import type { ChatParticipantState } from '../../generated/prisma/client';

/** Participant states whose owner is entitled to devices in the MLS group; PENDING invitees are included. */
export const ENTITLED_TO_LEAF_STATES: readonly ChatParticipantState[] = [
  'PENDING',
  'JOINING',
  'ACTIVE',
  'ARCHIVED',
  'BLOCKED',
];

/**
 * Most people a group can hold, counting everyone entitled to a leaf (invitees included): the
 * creator plus the 99 a create or add request may name, and what the notification consumer
 * accepts as recipients of one message.
 */
export const MAX_GROUP_MEMBERS = 100;

const ENTITLED_TO_LEAF: ReadonlySet<ChatParticipantState> = new Set(
  ENTITLED_TO_LEAF_STATES,
);

export function isEntitledToLeaf(
  state: ChatParticipantState | undefined,
): boolean {
  return state !== undefined && ENTITLED_TO_LEAF.has(state);
}

/** A device may be removed if its owner is not entitled, or the device is revoked or gone. */
export function isLeafRemovable(params: {
  ownerState: ChatParticipantState | undefined;
  deviceIsGone: boolean;
}): boolean {
  return params.deviceIsGone || !isEntitledToLeaf(params.ownerState);
}

/** The per-user views of a real member: not an invitee, not someone still joining. */
export const MEMBER_STATES: readonly ChatParticipantState[] = [
  'ACTIVE',
  'ARCHIVED',
  'BLOCKED',
];

export function isMemberState(
  state: ChatParticipantState | undefined,
): boolean {
  return state !== undefined && MEMBER_STATES.includes(state);
}
