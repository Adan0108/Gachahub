import type {
  ConversationId,
  DeviceCredential,
  DeviceId,
  Epoch,
  MembershipChangeRequest,
  PlaintextEnvelope,
  ProcessResult,
  UserId,
} from './types';

/**
 * The MlsClient contract - step 1 of the E2E encryption plan. Everything in
 * this file is library-agnostic: no candidate (ts-mls, OpenMLS-WASM, or
 * anything else) is referenced here.
 *
 * Step 2's bake-off writes one adapter per candidate implementing these
 * three interfaces, then runs the shared suite in contractTests.ts against
 * each one - the winner is whichever candidate actually passes it, not
 * whichever compiles first (critique C2).
 *
 * Split by responsibility (critique C3, Interface Segregation/SRP):
 * - DeviceIdentityStore: this browser device's own long-lived identity.
 * - GroupSessionFactory / GroupSession: one conversation's group state.
 * A SyncEngine (ordered delivery) and a SecureChatService (app-facing
 * coordinator) sit on top of these later - they're pure app logic with no
 * per-library variation, so they're out of scope for this contract.
 */

/**
 * Owns this browser device's long-lived MLS identity: its signature keypair
 * and key packages. One instance per logged-in user per browser profile,
 * persisted in an encrypted local store (threat-model §2, §5). Does NOT
 * know about conversations or groups - that's GroupSession's job.
 */
export interface DeviceIdentityStore {
  /** True once a local identity and at least one unclaimed key package exist. */
  isProvisioned(): Promise<boolean>;

  /**
   * Generates a fresh identity for this device. Not idempotent by design -
   * calling this when already provisioned creates a second, unrelated
   * identity. Callers must check isProvisioned() first.
   */
  provision(userId: UserId): Promise<DeviceCredential>;

  /** This device's own credential. Throws if not yet provisioned. */
  getOwnCredential(): Promise<DeviceCredential>;

  /**
   * Generates `count` fresh single-use key packages for upload to the
   * server, refreshing the one reusable last-resort package if it's
   * missing or expired (critique C1).
   */
  generateKeyPackages(count: number): Promise<Uint8Array[]>;

  /**
   * Revokes this device's identity and destroys its local keys.
   * Irreversible - matches "log out this device everywhere," never called
   * on an ordinary logout (threat-model §2: logging out must not delete
   * the device).
   */
  revoke(): Promise<void>;
}

/**
 * One instance per conversation. Owns that conversation's MLS group state -
 * the direct opposite of the MlsUser reference implementation's single
 * shared `group` field (critique A4).
 */
export interface GroupSession {
  readonly conversationId: ConversationId;

  /** Current local epoch, compared against the server's ChatConversation.mlsEpoch. */
  currentEpoch(): Promise<Epoch>;

  /**
   * Decrypts and applies one incoming wire item - application message,
   * proposal, or commit - in arrival order. Must be called serially per
   * conversation; the caller (SyncEngine) is responsible for never calling
   * this concurrently for the same conversationId, including across
   * browser tabs (critique C7).
   */
  process(wireBytes: Uint8Array): Promise<ProcessResult>;

  /**
   * Encrypts a plaintext envelope for the current epoch. Pure - does not
   * advance any state, safe to call even if the result is discarded.
   */
  encrypt(envelope: PlaintextEnvelope): Promise<Uint8Array>;

  /**
   * Stages an Add/Remove commit locally WITHOUT merging it - the fix for
   * MlsUser's premature `merge_pending_commit` (critique A4). The caller
   * must POST `wireBytes` (for every existing member, via process()) and
   * each entry of `welcomes` (one per newly-added device, delivered via the
   * backend's separate per-device Welcome channel - critique B's
   * `MlsWelcome` table) to the backend, then call exactly one of
   * commitAccepted / commitRejected with the result before calling
   * stageCommit again; calling stageCommit twice without resolving the
   * first is a caller bug, not something this interface needs to guard.
   */
  stageCommit(change: MembershipChangeRequest): Promise<{
    wireBytes: Uint8Array;
    expectedEpoch: Epoch;
    /** One Welcome per newly-added device. Empty when the commit only removed members. */
    welcomes: Array<{ deviceId: DeviceId; welcomeBytes: Uint8Array }>;
  }>;

  /** The backend accepted the staged commit (2xx) - merge it into local state now. */
  commitAccepted(): Promise<void>;

  /**
   * The backend rejected the staged commit (409 - another member's commit
   * won the race for this epoch). Discards the staged commit without
   * merging it. The caller is responsible for fetching and process()-ing
   * the winning commit next, then deciding whether its own proposal still
   * needs to be retried against the new epoch.
   */
  commitRejected(): Promise<void>;

  /**
   * Serializes everything needed to resume this session after a reload
   * (critique A3, A4) - ratchet tree, pending proposals, and this device's
   * per-epoch secrets not yet consumed by process(). Excludes anything
   * already-decrypted plaintext, which lives in the app's own local
   * message store, not here.
   */
  serialize(): Promise<Uint8Array>;
}

export interface GroupSessionFactory {
  /**
   * Creates a brand-new group for a first DM or group chat - this device
   * is the sole initial member. The caller adds other devices afterward
   * via stageCommit.
   */
  create(conversationId: ConversationId): Promise<GroupSession>;

  /** Restores a session from bytes produced by a prior GroupSession.serialize(). */
  restore(
    conversationId: ConversationId,
    state: Uint8Array,
  ): Promise<GroupSession>;

  /**
   * Joins an existing group via a Welcome message - the only way a session
   * comes into existence for a group this device didn't create. Rejects
   * (CredentialMismatchError) if the Welcome's group_id doesn't match
   * conversationId, or if it's addressed to a different device than this
   * store's own credential (critique C2's required test cases).
   */
  joinFromWelcome(
    conversationId: ConversationId,
    welcomeBytes: Uint8Array,
  ): Promise<GroupSession>;
}
