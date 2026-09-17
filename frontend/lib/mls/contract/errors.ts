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
