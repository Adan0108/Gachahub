import type { ConversationId, Epoch } from './types';

/** Thrown by GroupSession.commitRejected's caller path when the local device's staged commit lost the race for the next epoch (server returned 409) */
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

export class CredentialMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialMismatchError';
  }
}

export class MembershipMismatchError extends Error {
  constructor(
    public readonly conversationId: ConversationId,
    detail: string,
  ) {
    super(`Refused a commit in conversation ${conversationId}: ${detail}`);
    this.name = 'MembershipMismatchError';
  }
}

/** Thrown when a GroupSession cannot be restored - missing, corrupted, or from an incompatible serialization version */
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

/** Thrown when seeding a brand-new group finds nobody to add: every initial member is still PENDING (hasn't accepted) and this device has no other devices of its own either */
export class NoEncryptableMembersError extends Error {
  constructor(public readonly conversationId: ConversationId) {
    super(
      "Nobody has accepted this group invite yet, so there's no one to encrypt this message to.",
    );
    this.name = 'NoEncryptableMembersError';
  }
}

/** The saved group state exists but cannot be decrypted (corrupted, or its key is gone): never treated as "no group", so nothing silently rejoins over it. */
export class GroupStateCorruptedError extends Error {
  constructor(
    public readonly conversationId: ConversationId,
    cause?: unknown,
  ) {
    super(`Saved group state for conversation ${conversationId} cannot be read`, { cause });
    this.name = 'GroupStateCorruptedError';
  }
}
