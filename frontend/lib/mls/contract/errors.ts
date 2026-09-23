import type { ConversationId, Epoch } from './types';

/**
 * Thrown by GroupSession.commitRejected's caller path when the local
 * device's staged commit lost the race for the next epoch (server returned
 * 409). Not thrown internally by commitRejected itself - that method must
 * succeed and discard cleanly; this is for callers that skip straight to
 * asserting the epoch advanced.
 */
export class EpochConflictError extends Error {
  constructor(
    public readonly conversationId: ConversationId,
    public readonly expectedEpoch: Epoch,
  ) {
    super(
      `Commit rejected: epoch ${expectedEpoch} for conversation ${conversationId} was already taken`,
    );
    this.name = 'EpochConflictError';
  }
}

/**
 * Thrown when a credential inside an Add, Welcome, or Commit does not match
 * the userId/deviceId it claims to be (threat-model §1). Distinct from the
 * ProcessResult 'rejected' case: this is for call sites that need a hard
 * failure (e.g. joining a group via a bad Welcome) rather than a
 * process()-able rejection.
 */
export class CredentialMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialMismatchError';
  }
}

/**
 * Thrown when a Commit does not do what its sender told the server it does
 * (threat-model §3: a mismatch between the server roster and the MLS member
 * list is a fault, never something to paper over), or arrives in a way it
 * can't be checked at all. The Commit is NOT kept: the session stays at the
 * epoch before it, so this device never encrypts to - or trusts - a group it
 * could not verify. Later Commits build on the refused one, so the
 * conversation stays stuck here until someone looks into it.
 */
export class MembershipMismatchError extends Error {
  constructor(
    public readonly conversationId: ConversationId,
    detail: string,
  ) {
    super(`Refused a commit in conversation ${conversationId}: ${detail}`);
    this.name = 'MembershipMismatchError';
  }
}

/**
 * Thrown when a GroupSession cannot be restored - missing, corrupted, or
 * from an incompatible serialization version. The caller's only safe
 * recovery is treating this device as having no history for that
 * conversation (threat-model §5) and rejoining if possible.
 */
export class GroupStateUnavailableError extends Error {
  constructor(
    public readonly conversationId: ConversationId,
    cause?: unknown,
  ) {
    super(`Group state for conversation ${conversationId} is unavailable`, {
      cause,
    });
    this.name = 'GroupStateUnavailableError';
  }
}

/** A Welcome that is not a later epoch than the group this device already has: nothing to join, and its key package is spent. */
export class StaleWelcomeError extends Error {
  constructor() {
    super('This Welcome is not newer than the group this device already has');
    this.name = 'StaleWelcomeError';
  }
}

/**
 * Thrown when seeding a brand-new group finds nobody to add: every initial member is still
 * PENDING (hasn't accepted) and this device has no other devices of its own either. Committing
 * nothing would leave the group entirely private to this one device, with no way for the server
 * or any other client to ever bootstrap it afterward - membership work needs this device's own
 * leaf already in the roster, and self-join needs a published snapshot, and both of those are
 * only ever created by an accepted Commit, which never happens if none is sent. Not a silent
 * no-op: the caller discards the local group rather than leaving it half-set-up at epoch 0.
 */
export class NoEncryptableMembersError extends Error {
  constructor(public readonly conversationId: ConversationId) {
    super(
      "Nobody has accepted this group invite yet, so there's no one to encrypt this message to.",
    );
    this.name = 'NoEncryptableMembersError';
  }
}
