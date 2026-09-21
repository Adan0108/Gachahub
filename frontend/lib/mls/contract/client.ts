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
   * Generates `count` fresh key packages of the given kind for upload to
   * the server - SINGLE_USE (the default) for ordinary supply, or
   * LAST_RESORT for the one reusable fallback package a device offers
   * when it has no SINGLE_USE packages left (critique C1).
   */
  generateKeyPackages(count: number, kind?: 'SINGLE_USE' | 'LAST_RESORT'): Promise<Uint8Array[]>;

  /**
   * Marks a SINGLE_USE key package as spent once it's been matched to a
   * Welcome and used to join a group, so its private key doesn't linger
   * locally past that one use and a replayed/duplicated Welcome can't be
   * satisfied by it again. A no-op for any other kind, or an id this store
   * doesn't recognize.
   */
  consumeKeyPackage(id: string): Promise<void>;

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
   * Reads the epoch a wire item was framed under, without decrypting or
   * advancing any state - RFC 9420 puts groupId/epoch in PrivateMessage's
   * cleartext header specifically so this kind of routing check doesn't
   * need the ciphertext opened first. Returns undefined for bytes that
   * aren't a recognizable private message for this group; the caller
   * should fall back to process() and get a real error there instead of
   * trying to interpret that as any particular epoch.
   *
   * Exists so a caller with several incoming items can tell up front
   * whether any of them were encrypted under a later epoch than this
   * session's current one - the only case where catching up on missed
   * commits first is actually necessary - instead of always paying that
   * round trip before every single process() call.
   */
  peekEpoch(wireBytes: Uint8Array): Promise<Epoch | undefined>;

  /**
   * Every leaf in the current ratchet tree, as device credentials - so the
   * whole group can be checked against the server's roster, not just what
   * each Commit changed. Undefined when a leaf carries a credential that
   * can't be read.
   */
  listLeaves(): Promise<DeviceCredential[] | undefined>;

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
  restore(conversationId: ConversationId, state: Uint8Array): Promise<GroupSession>;

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
    options?: {
      /**
       * Runs on the joined session before its key package is spent. Throwing
       * MembershipMismatchError refuses the group for good and spends the
       * package; any other error keeps it, so the same Welcome can be retried.
       */
      verify?: (session: GroupSession) => Promise<void>;
    },
  ): Promise<GroupSession>;
}
