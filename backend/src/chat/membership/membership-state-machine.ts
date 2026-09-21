import type { ChatParticipantState } from '../../generated/prisma/client';

/**
 * What can happen to someone's place in a conversation. Authorization events
 * come from the app (an admin adds or removes, an invitee accepts); the two
 * COMMIT events come from the MLS side, when an accepted Commit finishes the
 * cryptographic half of a change the app already authorized.
 */
export type MembershipEvent =
  /** Added by an admin and entitled to join immediately (e.g. mutual follower). */
  | 'ADD_DIRECT'
  /** Added by an admin but must accept the invite first. */
  | 'ADD_INVITE'
  | 'ACCEPT_INVITE'
  | 'DECLINE_INVITE'
  /** An admin removes them, or they leave. */
  | 'REMOVE'
  /** An accepted Commit added one of their devices to the MLS group. */
  | 'COMMIT_ADDED'
  /** An accepted Commit removed the last of their devices from the MLS group. */
  | 'COMMIT_REMOVED'
  /**
   * The group's first Commit was accepted and none of their devices are in it.
   * Until now they were ACTIVE without any encryption to join.
   */
  | 'GROUP_ACTIVATED';

/** No participant row yet. */
export type MembershipFrom = ChatParticipantState | 'NONE';

export type MembershipTransition =
  | { kind: 'change'; to: ChatParticipantState }
  | { kind: 'noop' }
  /** The event makes no sense from this state - callers must not paper over it. */
  | { kind: 'illegal' };

type Outcome = ChatParticipantState | 'noop';

/**
 * Transitions for a conversation whose MLS group exists. Anything not listed
 * is illegal, so a new state or event fails closed until someone decides what
 * it should do.
 *
 * JOINING and LEAVING are the in-between states: authorized but not yet (or
 * no longer) cryptographically consistent. ACTIVE, ARCHIVED and BLOCKED are
 * per-user views of a member who holds a leaf in the MLS group; PENDING,
 * DECLINED and JOINING do not.
 */
const MLS_TRANSITIONS: Record<
  MembershipEvent,
  Partial<Record<MembershipFrom, Outcome>>
> = {
  ADD_DIRECT: {
    NONE: 'JOINING',
    DECLINED: 'JOINING',
    PENDING: 'JOINING',
    // The removal never landed, so their devices are still in the group.
    LEAVING: 'ACTIVE',
    JOINING: 'noop',
    ACTIVE: 'noop',
    ARCHIVED: 'noop',
    BLOCKED: 'noop',
  },
  ADD_INVITE: {
    NONE: 'PENDING',
    DECLINED: 'PENDING',
    PENDING: 'noop',
    LEAVING: 'ACTIVE',
    JOINING: 'noop',
    ACTIVE: 'noop',
    ARCHIVED: 'noop',
    BLOCKED: 'noop',
  },
  ACCEPT_INVITE: {
    PENDING: 'JOINING',
  },
  DECLINE_INVITE: {
    PENDING: 'DECLINED',
  },
  REMOVE: {
    NONE: 'noop',
    PENDING: 'DECLINED',
    JOINING: 'DECLINED',
    ACTIVE: 'LEAVING',
    ARCHIVED: 'LEAVING',
    BLOCKED: 'LEAVING',
    LEAVING: 'noop',
    DECLINED: 'noop',
  },
  COMMIT_ADDED: {
    JOINING: 'ACTIVE',
    ACTIVE: 'noop',
    ARCHIVED: 'noop',
    BLOCKED: 'noop',
  },
  COMMIT_REMOVED: {
    LEAVING: 'DECLINED',
    DECLINED: 'noop',
  },
  // ARCHIVED and BLOCKED are left alone: turning them into JOINING would lose
  // that per-user choice, and they only lack a device in a group that was
  // already running before MLS was introduced to it.
  GROUP_ACTIVATED: {
    ACTIVE: 'JOINING',
    ARCHIVED: 'noop',
    BLOCKED: 'noop',
    PENDING: 'noop',
    JOINING: 'noop',
    LEAVING: 'noop',
    DECLINED: 'noop',
  },
};

/**
 * Without an MLS group there is no cryptographic step to wait for: joining is
 * immediate and leaving is final, and the Commit events can never apply.
 */
const COLLAPSED_WHEN_NOT_MLS: Partial<
  Record<ChatParticipantState, ChatParticipantState>
> = {
  JOINING: 'ACTIVE',
  LEAVING: 'DECLINED',
};

const MLS_ONLY_EVENTS = new Set<MembershipEvent>([
  'COMMIT_ADDED',
  'COMMIT_REMOVED',
  'GROUP_ACTIVATED',
]);

export function resolveMembershipTransition(params: {
  from: MembershipFrom;
  event: MembershipEvent;
  /** Whether the conversation already has an MLS group (see MlsGroupRosterRepository.hasRoster). */
  mlsActive: boolean;
}): MembershipTransition {
  const { from, event, mlsActive } = params;

  if (!mlsActive && MLS_ONLY_EVENTS.has(event)) {
    return { kind: 'illegal' };
  }

  const outcome = MLS_TRANSITIONS[event][from];

  if (outcome === undefined) {
    return { kind: 'illegal' };
  }

  if (outcome === 'noop') {
    return { kind: 'noop' };
  }

  const to = mlsActive ? outcome : (COLLAPSED_WHEN_NOT_MLS[outcome] ?? outcome);

  return to === from ? { kind: 'noop' } : { kind: 'change', to };
}
