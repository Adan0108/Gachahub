/**
 * Shared value types for the MlsClient contract (step 1 of the E2E
 * encryption plan - see backend/docs/mls-threat-model.md). Library-agnostic
 * on purpose: nothing here may reference ts-mls, OpenMLS, or any other
 * candidate, so the same types work for every implementation in the step 2
 * bake-off.
 *
 * Wire/state bytes are Uint8Array everywhere. Base64 conversion happens in
 * exactly one place, at the HTTP boundary - never inside this module.
 */

export type DeviceId = string;
export type UserId = string;
export type ConversationId = string;

/** MLS epoch number for one conversation. Mirrors ChatConversation.mlsEpoch on the backend. */
export type Epoch = number;

/**
 * Asserts "this device belongs to this user." Every Add, Welcome, and
 * Commit carries one. Per threat-model §1, the server is not
 * cryptographically prevented from lying about this binding in v1 - a
 * GroupSession implementation MUST still check every credential it sees
 * against the userId/deviceId it claims, so a *mismatched* forged
 * credential is caught even though a correctly-labeled forged one isn't.
 */
export interface DeviceCredential {
  userId: UserId;
  deviceId: DeviceId;
  /** Raw MLS signature public key bytes for this device. */
  signatureKey: Uint8Array;
}

/**
 * The decrypted, application-level content of one MLS application message.
 * Deliberately generic ("envelope", not "ChatMessage") - MLS only needs to
 * move bytes; the chat layer above decides what `body` means per `type`.
 * See critique C4: encrypt a versioned envelope, not raw text, so edits/
 * deletes/reactions can travel as new encrypted messages clients apply
 * locally instead of the server mutating ciphertext in place.
 */
export interface PlaintextEnvelope {
  v: 1;
  type: 'text' | 'edit' | 'delete' | 'reaction';
  body: unknown;
}

/** Why an incoming wire item was rejected instead of processed. */
export type RejectReason =
  | 'credential-mismatch'
  | 'wrong-conversation'
  | 'wrong-device'
  | 'stale-epoch'
  | 'malformed';

/**
 * One device's published key package, fetched from the backend, plus the
 * identity it's supposed to belong to - the adder checks the two match
 * before trusting it (threat-model §1).
 */
export interface KeyPackageOffer {
  credential: DeviceCredential;
  keyPackage: Uint8Array;
}

/** Which device, without its key - enough to find its leaf in the group. */
export type DeviceIdentity = Pick<DeviceCredential, 'userId' | 'deviceId'>;

/**
 * What the caller supplies to GroupSession.stageCommit. Adding requires the
 * target device's actual key package bytes (not just its identity);
 * removing only needs to say which device to remove - the implementation
 * resolves that to a ratchet-tree leaf internally, so this contract never
 * has to expose leaf indices (or require a key the caller may not have, such
 * as when a device is being removed on the server's say-so).
 */
export interface MembershipChangeRequest {
  added: KeyPackageOffer[];
  removed: DeviceIdentity[];
}

/**
 * What ProcessResult's 'commit' case reports back: who actually joined or
 * left, as identities only - the receiver doesn't need the joiner's raw key
 * package bytes after the fact, just who they are.
 */
export interface MembershipChange {
  added: DeviceCredential[];
  removed: DeviceCredential[];
}

/**
 * Result of processing exactly one incoming wire item. Discriminated by
 * `kind` so a caller never has to guess what it received - fixes the
 * reference MlsUser implementation's bug of assuming every incoming item is
 * an application message when it can also be a proposal or commit (see
 * critique A4).
 */
export type ProcessResult =
  | {
      kind: 'application';
      senderDeviceId: DeviceId;
      epoch: Epoch;
      envelope: PlaintextEnvelope;
    }
  | {
      kind: 'commit';
      epoch: Epoch;
      membershipChange: MembershipChange | null;
    }
  | {
      kind: 'proposal';
      epoch: Epoch;
      proposalType: 'add' | 'remove';
      proposer: DeviceCredential;
      /**
       * True when this proposal arrived through the server's
       * external_senders mechanism rather than from a group member.
       * GroupSession implementations MUST reject an external proposal
       * whose proposalType is 'add' - accepting one would let a
       * compromised server insert an attacker's device using the exact
       * channel meant only for cleanup (threat-model §3).
       */
      isExternal: boolean;
    }
  | {
      kind: 'rejected';
      reason: RejectReason;
    };
