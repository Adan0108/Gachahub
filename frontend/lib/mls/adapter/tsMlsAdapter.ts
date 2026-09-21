import {
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeMlsMessage,
  encodeMlsMessage,
  encodeGroupState,
  decodeGroupState,
  generateKeyPackageWithKey,
  getCiphersuiteImpl,
  getCiphersuiteFromName,
  joinGroup,
  processPrivateMessage,
  emptyPskIndex,
  defaultCapabilities,
  type Credential,
  type CiphersuiteImpl,
  type ClientState,
  type KeyPackage,
  type PrivateKeyPackage,
  type RatchetTree,
  type LeafIndex,
  type Proposal,
} from 'ts-mls';
// Not re-exported from the package root - internal but reachable via the
// package's own "./*.js" subpath export map (see ts-mls's package.json).
import { toNodeIndex, nodeToLeafIndex } from 'ts-mls/treemath.js';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';
import { decryptSenderData } from 'ts-mls/privateMessage.js';
import { makeKeyPackageRef } from 'ts-mls/keyPackage.js';
import type {
  DeviceIdentityStore,
  GroupSession,
  GroupSessionFactory,
} from '../contract/client';
import type {
  ConversationId,
  DeviceCredential,
  DeviceId,
  Epoch,
  MembershipChangeRequest,
  PlaintextEnvelope,
  ProcessResult,
  UserId,
} from '../contract/types';
import { CredentialMismatchError } from '../contract/errors';
import { decodeIdentity, encodeIdentity } from './identityCodec';
import { diffLeafMembership } from './leafMembership';
import type { MlsClientCandidate } from '../contract/contractTests';
import {
  InMemoryDeviceIdentityStorage,
  type DeviceIdentityStorage,
  type StoredKeyPackage,
} from '../storage/deviceIdentityStorage';

/**
 * ts-mls adapter for the step 2 bake-off. Real crypto, real wire format -
 * this is what actually gets run against contractTests.ts, not a stub.
 *
 * Ciphersuite: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519, the one entry
 * in ts-mls's support table needing zero extra peer dependencies. Good
 * enough to prove the contract out; picking a final ciphersuite is a
 * separate decision once a library is actually chosen.
 */
export const CIPHERSUITE_NAME = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

// ts-mls's own defaultLifetime is notBefore=0/notAfter=max-int64 - an
// effectively-infinite key package a real server should never accept.
// Matches the backend's MAX_KEY_PACKAGE_LIFETIME_SECONDS
// (chat-devices/mls-key-package.util.ts) - keep the two in sync.
const KEY_PACKAGE_LIFETIME_DAYS = 90;

function boundedLifetime() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    notBefore: now,
    notAfter: now + BigInt(KEY_PACKAGE_LIFETIME_DAYS * 24 * 60 * 60),
  };
}

let cachedImpl: Promise<CiphersuiteImpl> | undefined;
function getImpl(): Promise<CiphersuiteImpl> {
  cachedImpl ??= getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE_NAME));
  return cachedImpl;
}

function encodeConversationId(conversationId: ConversationId): Uint8Array {
  return new TextEncoder().encode(conversationId);
}

const PLAINTEXT_ENVELOPE_TYPES = new Set(['text', 'edit', 'delete', 'reaction']);

/** Guards against a malformed or version-mismatched decrypted payload rather than trusting contract/types.ts's shape via a bare cast. */
function isPlaintextEnvelope(value: unknown): value is PlaintextEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { v?: unknown }).v === 1 &&
    PLAINTEXT_ENVELOPE_TYPES.has((value as { type?: unknown }).type as string)
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export class TsMlsDeviceIdentityStore implements DeviceIdentityStore {
  private deviceId: DeviceId | undefined;
  private credential: DeviceCredential | undefined;
  // One persistent identity signing keypair, reused for every key package
  // this device ever creates. generateKeyPackage() (no "WithKey") mints a
  // FRESH signature key on every call - using it directly would mean each
  // key package for the same device reports a different signaturePublicKey,
  // making device identity meaningless for pinning/safety-number checks.
  private signatureKeyPair: { signKey: Uint8Array; publicKey: Uint8Array } | undefined;
  private nextKeyPackageId = 0;
  readonly keyPackagesById = new Map<string, StoredKeyPackage>();
  private hydrationPromise: Promise<void> | undefined;

  constructor(private readonly storage: DeviceIdentityStorage = new InMemoryDeviceIdentityStorage()) {}

  async isProvisioned(): Promise<boolean> {
    await this.ensureHydrated();
    return this.credential !== undefined;
  }

  async provision(userId: UserId): Promise<DeviceCredential> {
    // Nothing to hydrate once we're about to establish fresh state - and a
    // concurrent hydration finishing afterward must not clobber it.
    this.hydrationPromise = Promise.resolve();

    const impl = await getImpl();
    this.deviceId = crypto.randomUUID();
    this.signatureKeyPair = await impl.signature.keygen();
    const mlsCredential: Credential = {
      credentialType: 'basic',
      identity: encodeIdentity(userId, this.deviceId),
    };
    const kp = await generateKeyPackageWithKey(
      mlsCredential,
      defaultCapabilities(),
      boundedLifetime(),
      [],
      this.signatureKeyPair,
      impl,
    );
    // Never uploaded, never offered to anyone - this device's own package
    // for founding groups it creates itself (TsMlsGroupSessionFactory.
    // create/pickOwnKeyPackage). Tagged FOUNDER, not SINGLE_USE, so it's
    // found by that explicit kind rather than by happening to be the
    // first entry generateKeyPackages() hasn't added yet.
    this.storeKeyPackage(kp.publicPackage, kp.privatePackage, 'FOUNDER');
    this.credential = {
      userId,
      deviceId: this.deviceId,
      signatureKey: this.signatureKeyPair.publicKey,
    };
    await this.persist();
    return this.credential;
  }

  async getOwnCredential(): Promise<DeviceCredential> {
    await this.ensureHydrated();
    if (!this.credential) {
      throw new Error('Device not provisioned yet');
    }
    return this.credential;
  }

  /**
   * Returns raw base64-free encodeMlsMessage(mls_key_package) bytes - no
   * adapter-specific wrapping. This is exactly what the backend's
   * KeyPackageItemDto.payload expects once base64-encoded, and exactly what
   * stageCommit's offer.keyPackage expects on the other end - a real
   * KeyPackageRef (computed from the key package itself, see
   * findMatchingKeyPackage below) is what lets a joiner recognize a Welcome
   * addressed to it, not an out-of-band id.
   */
  async generateKeyPackages(
    count: number,
    kind: 'SINGLE_USE' | 'LAST_RESORT' = 'SINGLE_USE',
  ): Promise<Uint8Array[]> {
    await this.ensureHydrated();
    if (!this.credential || !this.signatureKeyPair || !this.deviceId) {
      throw new Error('Device not provisioned yet');
    }
    const impl = await getImpl();
    const mlsCredential: Credential = {
      credentialType: 'basic',
      identity: encodeIdentity(this.credential.userId, this.deviceId),
    };
    const out: Uint8Array[] = [];
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- each key package's keygen depends on none of the others, but ts-mls's API is one-at-a-time
      const kp = await generateKeyPackageWithKey(
        mlsCredential,
        defaultCapabilities(),
        boundedLifetime(),
        [],
        this.signatureKeyPair,
        impl,
      );
      this.storeKeyPackage(kp.publicPackage, kp.privatePackage, kind);
      out.push(
        encodeMlsMessage({
          keyPackage: kp.publicPackage,
          wireformat: 'mls_key_package',
          version: 'mls10',
        }),
      );
    }
    await this.persist();
    return out;
  }

  /**
   * Removes a used SINGLE_USE key package's private key from local storage
   * - its one-time secret has already been spent by the join it was
   * matched to, so keeping it around only extends how long that key
   * material sits on disk for no benefit, and lets a replayed/duplicated
   * Welcome for a different conversation be satisfied by it again. Only
   * SINGLE_USE is ever actually consumed here (an allow-list, not a
   * LAST_RESORT deny-list): LAST_RESORT is meant to satisfy more than one
   * Welcome when a device has no SINGLE_USE packages left, and FOUNDER is
   * never uploaded or offered to begin with, so findMatchingKeyPackage
   * could never legitimately match either kind anyway - this is defense
   * in depth against that assumption ever breaking, not the thing
   * currently preventing it.
   */
  async consumeKeyPackage(id: string): Promise<void> {
    const stored = this.keyPackagesById.get(id);
    if (!stored || stored.kind !== 'SINGLE_USE') {
      return;
    }
    this.keyPackagesById.delete(id);
    await this.persist();
  }

  async revoke(): Promise<void> {
    this.hydrationPromise = Promise.resolve();
    this.deviceId = undefined;
    this.credential = undefined;
    this.signatureKeyPair = undefined;
    this.nextKeyPackageId = 0;
    this.keyPackagesById.clear();
    await this.storage.clear();
  }

  private ensureHydrated(): Promise<void> {
    if (!this.hydrationPromise) {
      this.hydrationPromise = this.hydrate().catch((error: unknown) => {
        // Let a real storage failure be retried on the next call instead of
        // permanently wedging this store on one bad attempt.
        this.hydrationPromise = undefined;
        throw error;
      });
    }
    return this.hydrationPromise;
  }

  private async hydrate(): Promise<void> {
    const persisted = await this.storage.load();
    if (!persisted) {
      return;
    }
    this.deviceId = persisted.deviceId;
    this.credential = persisted.credential;
    this.signatureKeyPair = persisted.signatureKeyPair;
    this.nextKeyPackageId = persisted.nextKeyPackageId;
    this.keyPackagesById.clear();
    for (const keyPackage of persisted.keyPackages) {
      this.keyPackagesById.set(keyPackage.id, keyPackage);
    }
  }

  private async persist(): Promise<void> {
    if (!this.credential || !this.deviceId || !this.signatureKeyPair) {
      return;
    }
    await this.storage.save({
      deviceId: this.deviceId,
      credential: this.credential,
      signatureKeyPair: this.signatureKeyPair,
      nextKeyPackageId: this.nextKeyPackageId,
      keyPackages: [...this.keyPackagesById.values()],
    });
  }

  private storeKeyPackage(
    publicPackage: KeyPackage,
    privatePackage: PrivateKeyPackage,
    kind: StoredKeyPackage['kind'],
  ): string {
    const id = `kp-${this.nextKeyPackageId}`;
    this.nextKeyPackageId += 1;
    this.keyPackagesById.set(id, { id, kind, publicPackage, privatePackage });
    return id;
  }
}

function findLeafIndexByIdentity(
  tree: RatchetTree,
  userId: UserId,
  deviceId: DeviceId,
): LeafIndex | undefined {
  for (let i = 0; i < tree.length; i += 1) {
    const node = tree[i];
    if (node?.nodeType !== 'leaf') continue;
    const credential = node.leaf.credential;
    if (credential.credentialType !== 'basic') continue;
    const identity = decodeIdentity(credential.identity);
    if (identity && identity.userId === userId && identity.deviceId === deviceId) {
      return nodeToLeafIndex(toNodeIndex(i));
    }
  }
  return undefined;
}

class TsMlsGroupSession implements GroupSession {
  private staged:
    | { newState: ClientState; welcome: Uint8Array | undefined }
    | undefined;

  constructor(
    public readonly conversationId: ConversationId,
    private state: ClientState,
    private readonly credential: DeviceCredential,
  ) {}

  async currentEpoch(): Promise<Epoch> {
    return Number(this.state.groupContext.epoch);
  }

  async peekEpoch(wireBytes: Uint8Array): Promise<Epoch | undefined> {
    const decoded = decodeMlsMessage(wireBytes, 0)?.[0];
    if (!decoded || decoded.wireformat !== 'mls_private_message') {
      return undefined;
    }
    if (!bytesEqual(decoded.privateMessage.groupId, encodeConversationId(this.conversationId))) {
      return undefined;
    }
    return Number(decoded.privateMessage.epoch);
  }

  async process(wireBytes: Uint8Array): Promise<ProcessResult> {
    const decoded = decodeMlsMessage(wireBytes, 0)?.[0];
    if (!decoded || decoded.wireformat !== 'mls_private_message') {
      return { kind: 'rejected', reason: 'malformed' };
    }

    if (!bytesEqual(decoded.privateMessage.groupId, encodeConversationId(this.conversationId))) {
      return { kind: 'rejected', reason: 'wrong-conversation' };
    }

    const impl = await getImpl();

    let incomingKind: 'commit' | 'proposal' | undefined;
    let proposalInfo:
      | { proposal: Proposal; proposer: DeviceCredential; isExternal: boolean }
      | undefined;
    // A member-sent proposal whose credential didn't decode - distinct from
    // proposalInfo being absent (e.g. this was a commit, not a proposal).
    let proposalCredentialMismatch = false;
    const treeBeforeCommit = this.state.ratchetTree;

    // SenderData is encrypted separately from the actual message content
    // (a lighter, non-ratchet-consuming layer meant for exactly this kind
    // of metadata lookup), so peeking at it here doesn't touch the
    // per-generation keys processPrivateMessage still needs to consume
    // right after - safe to decrypt both without double-consuming anything.
    const senderData = await decryptSenderData(
      decoded.privateMessage,
      this.state.keySchedule.senderDataSecret,
      impl,
    );
    const senderNode =
      senderData !== undefined ? treeBeforeCommit[senderData.leafIndex * 2] : undefined;
    const senderIdentity =
      senderNode?.nodeType === 'leaf' && senderNode.leaf.credential.credentialType === 'basic'
        ? decodeIdentity(senderNode.leaf.credential.identity)
        : undefined;

    // Resolved from the tree as it stood BEFORE this message - no
    // one-time key consumed yet - so an application message with an
    // unidentifiable sender can be rejected here instead of after
    // decrypting it, where there'd be no way to "undo" that consumption
    // just to report the failure.
    if (decoded.privateMessage.contentType === 'application' && !senderIdentity) {
      return { kind: 'rejected', reason: 'credential-mismatch' };
    }

    const result = await processPrivateMessage(
      this.state,
      decoded.privateMessage,
      emptyPskIndex,
      impl,
      (incoming) => {
        incomingKind = incoming.kind;
        if (incoming.kind === 'proposal') {
          const senderLeaf = incoming.proposal.senderLeafIndex;
          // Only a "member" sender has a leaf index (sender.d.ts) - a
          // standalone proposal with none came through some other channel
          // (external_senders, a new-member self-proposal/commit), none of
          // which this app configures anywhere today.
          const isExternal = senderLeaf === undefined;
          const senderNode = !isExternal ? treeBeforeCommit[senderLeaf * 2] : undefined;
          const proposerCredential =
            senderNode?.nodeType === 'leaf' && senderNode.leaf.credential.credentialType === 'basic'
              ? decodeIdentity(senderNode.leaf.credential.identity)
              : undefined;

          // A real member sent this (not external) but its credential
          // isn't decodable - reporting it under a fabricated 'unknown'
          // identity would silently defeat any pinning/safety-number check
          // built on DeviceCredential.signatureKey. Reject it outright
          // instead; 'external' proposals genuinely have no member
          // identity to report, which 'unknown' below still covers.
          if (!isExternal && !proposerCredential) {
            proposalCredentialMismatch = true;
            return 'reject';
          }

          proposalInfo = {
            proposal: incoming.proposal.proposal,
            proposer: proposerCredential
              ? { ...proposerCredential, signatureKey: new Uint8Array() }
              : { userId: 'unknown', deviceId: 'unknown', signatureKey: new Uint8Array() },
            isExternal,
          };

          // types.ts's ProcessResult.isExternal doc: a GroupSession MUST
          // reject an external proposal whose proposalType is 'add' - a
          // compromised server could otherwise insert an attacker's device
          // through this channel. Returning 'reject' here stops ts-mls from
          // ever applying it to local state (processProposal is skipped);
          // the caller still learns about it via the isExternal flag above.
          if (isExternal && incoming.proposal.proposal.proposalType === 'add') {
            return 'reject';
          }
        }
        return 'accept';
      },
    );

    if (result.kind === 'applicationMessage') {
      this.state = result.newState;
      let envelope: unknown;
      try {
        envelope = JSON.parse(new TextDecoder().decode(result.message));
      } catch {
        return { kind: 'rejected', reason: 'malformed' };
      }
      if (!isPlaintextEnvelope(envelope)) {
        return { kind: 'rejected', reason: 'malformed' };
      }
      return {
        kind: 'application',
        // Guaranteed resolved: the early return above already rejected
        // this message before processPrivateMessage ran if it weren't.
        senderDeviceId: senderIdentity!.deviceId,
        epoch: Number(this.state.groupContext.epoch),
        envelope,
      };
    }

    this.state = result.newState;

    if (proposalCredentialMismatch) {
      return { kind: 'rejected', reason: 'credential-mismatch' };
    }

    if (incomingKind === 'proposal' && proposalInfo) {
      return {
        kind: 'proposal',
        epoch: Number(this.state.groupContext.epoch),
        proposalType: proposalInfo.proposal.proposalType === 'add' ? 'add' : 'remove',
        proposer: proposalInfo.proposer,
        isExternal: proposalInfo.isExternal,
      };
    }

    const membershipChange = diffLeafMembership(treeBeforeCommit, this.state.ratchetTree);
    if (!membershipChange) {
      return { kind: 'rejected', reason: 'credential-mismatch' };
    }

    return {
      kind: 'commit',
      epoch: Number(this.state.groupContext.epoch),
      membershipChange,
    };
  }

  async encrypt(envelope: PlaintextEnvelope): Promise<Uint8Array> {
    const impl = await getImpl();
    const plaintext = new TextEncoder().encode(JSON.stringify(envelope));
    const result = await createApplicationMessage(this.state, plaintext, impl);
    this.state = result.newState;
    return encodeMlsMessage({
      privateMessage: result.privateMessage,
      wireformat: 'mls_private_message',
      version: 'mls10',
    });
  }

  async stageCommit(change: MembershipChangeRequest): Promise<{
    wireBytes: Uint8Array;
    expectedEpoch: Epoch;
    welcomes: Array<{ deviceId: DeviceId; welcomeBytes: Uint8Array }>;
  }> {
    const impl = await getImpl();
    const expectedEpoch = Number(this.state.groupContext.epoch);

    const addedDeviceIds: DeviceId[] = [];
    const extraProposals: Proposal[] = [];

    for (const offer of change.added) {
      const decoded = decodeMlsMessage(offer.keyPackage, 0)?.[0];
      if (!decoded || decoded.wireformat !== 'mls_key_package') {
        throw new CredentialMismatchError('Offered bytes are not a valid key package');
      }
      const embeddedCredential = decoded.keyPackage.leafNode.credential;
      if (embeddedCredential.credentialType !== 'basic') {
        throw new CredentialMismatchError('Only basic credentials are supported');
      }
      const identity = decodeIdentity(embeddedCredential.identity);
      if (
        !identity ||
        identity.userId !== offer.credential.userId ||
        identity.deviceId !== offer.credential.deviceId
      ) {
        throw new CredentialMismatchError(
          identity
            ? `Key package identity (${identity.userId}/${identity.deviceId}) does not match the offered credential (${offer.credential.userId}/${offer.credential.deviceId})`
            : 'Key package identity is not decodable',
        );
      }
      addedDeviceIds.push(offer.credential.deviceId);
      extraProposals.push({ proposalType: 'add', add: { keyPackage: decoded.keyPackage } });
    }

    for (const removed of change.removed) {
      const leafIndex = findLeafIndexByIdentity(
        this.state.ratchetTree,
        removed.userId,
        removed.deviceId,
      );
      if (leafIndex === undefined) {
        throw new Error(
          `Cannot remove ${removed.userId}/${removed.deviceId}: not a current member`,
        );
      }
      extraProposals.push({ proposalType: 'remove', remove: { removed: leafIndex } });
    }

    const commitResult = await createCommit(
      { state: this.state, cipherSuite: impl },
      { extraProposals, ratchetTreeExtension: true },
    );

    this.staged = { newState: commitResult.newState, welcome: undefined };

    const wireBytes = encodeMlsMessage(commitResult.commit);

    const welcomes: Array<{ deviceId: DeviceId; welcomeBytes: Uint8Array }> = [];
    if (commitResult.welcome && addedDeviceIds.length > 0) {
      // One Welcome message carries secrets for every newly-added device at
      // once (Welcome.secrets[], each entry a KeyPackageRef) - the same
      // bytes go to every added device, and each recognizes its own entry
      // itself (joinFromWelcome/findMatchingKeyPackage), same as a real MLS
      // client would. ratchetTreeExtension: true above means the tree
      // travels inside this Welcome's own GroupInfo - joinGroup recovers it
      // from there, no separate out-of-band tree needed.
      const welcomeBytes = encodeMlsMessage({
        welcome: commitResult.welcome,
        wireformat: 'mls_welcome',
        version: 'mls10',
      });
      for (const deviceId of addedDeviceIds) {
        welcomes.push({ deviceId, welcomeBytes });
      }
    }

    return { wireBytes, expectedEpoch, welcomes };
  }

  async commitAccepted(): Promise<void> {
    if (!this.staged) {
      throw new Error('commitAccepted called with no staged commit');
    }
    this.state = this.staged.newState;
    this.staged = undefined;
  }

  async commitRejected(): Promise<void> {
    this.staged = undefined;
  }

  async serialize(): Promise<Uint8Array> {
    return encodeGroupState(this.state);
  }
}

export class TsMlsGroupSessionFactory implements GroupSessionFactory {
  constructor(private readonly store: TsMlsDeviceIdentityStore) {}

  async create(conversationId: ConversationId): Promise<GroupSession> {
    const impl = await getImpl();
    const credential = await this.store.getOwnCredential();
    const own = this.pickOwnKeyPackage();
    const state = await createGroup(
      encodeConversationId(conversationId),
      own.publicPackage,
      own.privatePackage,
      [],
      impl,
    );
    return new TsMlsGroupSession(conversationId, state, credential);
  }

  async restore(conversationId: ConversationId, stateBytes: Uint8Array): Promise<GroupSession> {
    const credential = await this.store.getOwnCredential();
    const groupState = decodeGroupState(stateBytes, 0)?.[0];
    if (!groupState) {
      throw new Error('Could not decode serialized group state');
    }
    if (!bytesEqual(groupState.groupContext.groupId, encodeConversationId(conversationId))) {
      // Same check joinFromWelcome already makes on a Welcome - a storage
      // bug or key collision handing this conversationId the wrong bytes
      // should fail loudly here, not silently resume as the wrong group.
      throw new CredentialMismatchError(
        `Restored state is for a different conversation than "${conversationId}"`,
      );
    }
    // encodeGroupState only serializes GroupState, not the clientConfig half
    // of ClientState (it's static config, not group state) - reattach the
    // defaults on restore, same as createGroup/joinGroup do when the caller
    // doesn't override them.
    const state: ClientState = { ...groupState, clientConfig: defaultClientConfig };
    return new TsMlsGroupSession(conversationId, state, credential);
  }

  async joinFromWelcome(
    conversationId: ConversationId,
    welcomeBytes: Uint8Array,
  ): Promise<GroupSession> {
    const decoded = decodeMlsMessage(welcomeBytes, 0)?.[0];
    if (!decoded || decoded.wireformat !== 'mls_welcome') {
      throw new CredentialMismatchError('Bytes do not contain an MLS Welcome message');
    }

    // getOwnCredential() is also what triggers the store's lazy hydration
    // from persistent storage - must run before keyPackagesById is read
    // below, or a freshly-constructed (not yet hydrated) store would always
    // report "no matching key package" right after a reload.
    const credential = await this.store.getOwnCredential();
    const impl = await getImpl();
    const matching = await this.findMatchingKeyPackage(decoded.welcome, impl);
    if (!matching) {
      throw new CredentialMismatchError(
        'This Welcome is not addressed to any key package this device holds',
      );
    }

    // No explicit ratchetTree argument - stageCommit sets
    // ratchetTreeExtension: true, so joinGroup recovers the tree from the
    // Welcome's own GroupInfo extension.
    const state = await joinGroup(
      decoded.welcome,
      matching.publicPackage,
      matching.privatePackage,
      emptyPskIndex,
      impl,
    );

    if (!bytesEqual(state.groupContext.groupId, encodeConversationId(conversationId))) {
      throw new CredentialMismatchError(
        `Welcome is for a different conversation than "${conversationId}"`,
      );
    }

    // Only after the join actually succeeds - a failed joinGroup or a
    // wrong-conversation Welcome above should leave the package available
    // for a genuine retry, not consume it on a doomed attempt.
    await this.store.consumeKeyPackage(matching.id);

    return new TsMlsGroupSession(conversationId, state, credential);
  }

  private async findMatchingKeyPackage(
    welcome: Parameters<typeof joinGroup>[0],
    impl: CiphersuiteImpl,
  ) {
    for (const stored of this.store.keyPackagesById.values()) {
      const ref = await makeKeyPackageRef(stored.publicPackage, impl.hash);
      if (welcome.secrets.some((secret) => bytesEqual(secret.newMember, ref))) {
        return stored;
      }
    }
    return undefined;
  }

  /**
   * Looked up by its FOUNDER kind, not by map/insertion order - it used to
   * just grab the first entry in keyPackagesById, relying on provision()
   * always running (and storing its package) before generateKeyPackages()
   * ever does. That worked only because the package it happened to grab
   * was never actually uploaded or claimable; an explicit kind means this
   * can't silently start returning a claimable SINGLE_USE/LAST_RESORT
   * package instead if that insertion order ever changed.
   */
  private pickOwnKeyPackage() {
    const founder = [...this.store.keyPackagesById.values()].find(
      (stored) => stored.kind === 'FOUNDER',
    );
    if (!founder) {
      throw new Error('Device has no key packages - call provision() first');
    }
    return founder;
  }
}

export const tsMlsCandidate: MlsClientCandidate = {
  name: 'ts-mls',
  createDeviceIdentityStore: () => new TsMlsDeviceIdentityStore(),
  createGroupSessionFactory: (store) =>
    new TsMlsGroupSessionFactory(store as TsMlsDeviceIdentityStore),
};
