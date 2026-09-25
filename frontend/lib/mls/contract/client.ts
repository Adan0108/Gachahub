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


/** Owns this browser device's long-lived MLS identity: its signature keypair and key packages */
export interface DeviceIdentityStore {
  /** True once a local identity and at least one unclaimed key package exist. */
  isProvisioned(): Promise<boolean>;

  /** Generates a fresh identity for this device */
  provision(userId: UserId): Promise<DeviceCredential>;

  /** Proves to the server, when linking a login to this device, that this browser holds the device key */
  signSessionLinkChallenge(challenge: string): Promise<Uint8Array>;

  /** This device's own credential */
  getOwnCredential(): Promise<DeviceCredential>;

  generateKeyPackages(count: number, kind?: 'SINGLE_USE' | 'LAST_RESORT'): Promise<Uint8Array[]>;

  consumeKeyPackage(id: string): Promise<void>;

  /** Revokes this device's identity and destroys its local keys */
  revoke(): Promise<void>;
}

/** One instance per conversation */
export interface GroupSession {
  readonly conversationId: ConversationId;

  /** Current local epoch, compared against the server's ChatConversation.mlsEpoch. */
  currentEpoch(): Promise<Epoch>;

  /** Reads the epoch a wire item was framed under, without decrypting or advancing any state - RFC 9420 puts groupId/epoch in PrivateMessage's cleartext header specifically so this kind of routing check doesn't need the ciphertext opened first */
  peekEpoch(wireBytes: Uint8Array): Promise<Epoch | undefined>;

  /** Every leaf in the current ratchet tree, as device credentials - so the whole group can be checked against the server's roster, not just what each Commit changed */
  listLeaves(): Promise<DeviceCredential[] | undefined>;

  /** Decrypts and applies one incoming wire item - application message, proposal, or commit - in arrival order */
  process(wireBytes: Uint8Array): Promise<ProcessResult>;

  /** Encrypts a plaintext envelope for the current epoch */
  encrypt(envelope: PlaintextEnvelope): Promise<Uint8Array>;

  stageCommit(change: MembershipChangeRequest): Promise<{
    wireBytes: Uint8Array;
    expectedEpoch: Epoch;
    /** A signed, public snapshot of the group as it will be AFTER this commit */
    groupInfo: Uint8Array;
    /** The one Welcome for all newly-added devices */
    welcome?: { deviceIds: DeviceId[]; welcomeBytes: Uint8Array };
  }>;

  /** The backend accepted the staged commit (2xx) - merge it into local state now. */
  commitAccepted(): Promise<void>;

  /** The backend rejected the staged commit (409 - another member's commit won the race for this epoch) */
  commitRejected(): Promise<void>;

  serialize(): Promise<Uint8Array>;
}

export interface GroupSessionFactory {
  /** Creates a brand-new group for a first DM or group chat - this device is the sole initial member */
  create(conversationId: ConversationId): Promise<GroupSession>;

  /** Restores a session from bytes produced by a prior GroupSession.serialize(). */
  restore(conversationId: ConversationId, state: Uint8Array): Promise<GroupSession>;

  /** Joins an existing group via a Welcome message - the only way a session comes into existence for a group this device didn't create */
  /** Joins a group with no help from any member, from its published GroupInfo (an MLS "external commit") */
  joinExternally(
    conversationId: ConversationId,
    groupInfoBytes: Uint8Array,
  ): Promise<{ session: GroupSession; commitBytes: Uint8Array; groupInfoBytes: Uint8Array }>;

  joinFromWelcome(
    conversationId: ConversationId,
    welcomeBytes: Uint8Array,
    options?: {
      /** Runs on the joined session before its key package is spent */
      verify?: (session: GroupSession) => Promise<void>;
      /** Runs once the join is verified and BEFORE the key package is spent: save the session here so a crash cannot lose the join */
      onAccepted?: (session: GroupSession) => Promise<void>;
    },
  ): Promise<GroupSession>;
}
