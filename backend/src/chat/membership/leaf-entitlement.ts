import type { ChatParticipantState } from '../../generated/prisma/client';

/**
 * The participant states whose owner is entitled to have devices in the MLS
 * group. One definition, used everywhere the question comes up: the rules a
 * Commit is checked against, and the work a device is asked to do. Two copies
 * are how the two drift apart - and whatever falls in the gap never gets done.
 *
 * ACTIVE, ARCHIVED and BLOCKED are per-user views of a member; JOINING is
 * someone the server has authorized to join. PENDING is entitled too - an
 * invitee reads and decrypts real history from the moment they're invited,
 * before they ever accept (see membership-state-machine.ts). Everyone else
 * (DECLINED, LEAVING, or no participant row at all) is not entitled.
 */
export const ENTITLED_TO_LEAF_STATES: readonly ChatParticipantState[] = [
  'PENDING',
  'JOINING',
  'ACTIVE',
  'ARCHIVED',
  'BLOCKED',
];

const ENTITLED_TO_LEAF: ReadonlySet<ChatParticipantState> = new Set(
  ENTITLED_TO_LEAF_STATES,
);

export function isEntitledToLeaf(
  state: ChatParticipantState | undefined,
): boolean {
  return state !== undefined && ENTITLED_TO_LEAF.has(state);
}

/**
 * A device in the group may be removed if its owner has no right to be there,
 * or the device itself is revoked or gone - a lost or stolen device must stop
 * receiving new epochs even when its owner is still a member.
 */
export function isLeafRemovable(params: {
  ownerState: ChatParticipantState | undefined;
  deviceIsGone: boolean;
}): boolean {
  return params.deviceIsGone || !isEntitledToLeaf(params.ownerState);
}
