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
import { encodeRatchetTree, decodeRatchetTree } from 'ts-mls/ratchetTree.js';
import { toNodeIndex, nodeToLeafIndex } from 'ts-mls/treemath.js';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';
import { decryptSenderData } from 'ts-mls/privateMessage.js';
import type {
  DeviceIdentityStore,
  GroupSession,
  GroupSessionFactory,
} from './client';
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
import { CredentialMismatchError } from './errors';
import type { MlsClientCandidate } from './contractTests';
import {
  InMemoryDeviceIdentityStorage,
  type DeviceIdentityStorage,
  type StoredKeyPackage,
} from './deviceIdentityStorage';
import { bytesToBase64, base64ToBytes } from './base64';

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

function encodeIdentity(userId: UserId, deviceId: DeviceId): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ userId, deviceId }));
}

function decodeIdentity(identity: Uint8Array): { userId: UserId; deviceId: DeviceId } {
  return JSON.parse(new TextDecoder().decode(identity));
}

/** This adapter's own envelope around ts-mls wire bytes - opaque from the contract's point of view. */
interface Envelope {
  conversationId: ConversationId;
  mls: string; // base64 encodeMlsMessage(...) bytes
  ratchetTree?: string; // base64, only present on a Welcome envelope
  keyPackageId?: string; // only present on a Welcome envelope
}

function packEnvelope(envelope: Envelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

function unpackEnvelope(bytes: Uint8Array): Envelope {
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Extracts the raw base64 MLS KeyPackage wire bytes from an envelope
 * produced by generateKeyPackages(), for uploading to the backend's
 * chat-devices endpoints - the envelope's conversationId/keyPackageId
 * fields are this adapter's own local bookkeeping, not part of what the
 * server needs (KeyPackageItemDto.payload wants exactly this base64 string).
 */
export function extractKeyPackagePayload(envelope: Uint8Array): string {
  return unpackEnvelope(envelope).mls;
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
    this.storeKeyPackage(kp.publicPackage, kp.privatePackage);
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

  async generateKeyPackages(count: number): Promise<Uint8Array[]> {
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
      const id = this.storeKeyPackage(kp.publicPackage, kp.privatePackage);
      out.push(
        packEnvelope({
          conversationId: '',
          mls: bytesToBase64(
            encodeMlsMessage({
              keyPackage: kp.publicPackage,
              wireformat: 'mls_key_package',
              version: 'mls10',
            }),
          ),
          keyPackageId: id,
        }),
      );
    }
    await this.persist();
    return out;
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
  ): string {
    const id = `kp-${this.nextKeyPackageId}`;
    this.nextKeyPackageId += 1;
    this.keyPackagesById.set(id, { id, publicPackage, privatePackage });
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
    if (identity.userId === userId && identity.deviceId === deviceId) {
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

  async process(wireBytes: Uint8Array): Promise<ProcessResult> {
    const envelope = unpackEnvelope(wireBytes);
    if (envelope.conversationId !== this.conversationId) {
      return { kind: 'rejected', reason: 'wrong-conversation' };
    }

    const impl = await getImpl();
    const decoded = decodeMlsMessage(base64ToBytes(envelope.mls), 0)?.[0];
    if (!decoded || decoded.wireformat !== 'mls_private_message') {
      return { kind: 'rejected', reason: 'malformed' };
    }

    let incomingKind: 'commit' | 'proposal' | undefined;
    let proposalInfo: { proposal: Proposal; proposer: DeviceCredential } | undefined;
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

    const result = await processPrivateMessage(
      this.state,
      decoded.privateMessage,
      emptyPskIndex,
      impl,
      (incoming) => {
        incomingKind = incoming.kind;
        if (incoming.kind === 'proposal') {
          const senderLeaf = incoming.proposal.senderLeafIndex;
          const senderNode =
            senderLeaf !== undefined ? treeBeforeCommit[senderLeaf * 2] : undefined;
          const proposerCredential =
            senderNode?.nodeType === 'leaf' && senderNode.leaf.credential.credentialType === 'basic'
              ? decodeIdentity(senderNode.leaf.credential.identity)
              : undefined;
          proposalInfo = {
            proposal: incoming.proposal.proposal,
            proposer: proposerCredential
              ? { ...proposerCredential, signatureKey: new Uint8Array() }
              : { userId: 'unknown', deviceId: 'unknown', signatureKey: new Uint8Array() },
          };
        }
        return 'accept';
      },
    );

    if (result.kind === 'applicationMessage') {
      this.state = result.newState;
      return {
        kind: 'application',
        senderDeviceId: senderIdentity?.deviceId ?? 'unknown',
        epoch: Number(this.state.groupContext.epoch),
        envelope: JSON.parse(new TextDecoder().decode(result.message)) as PlaintextEnvelope,
      };
    }

    this.state = result.newState;

    if (incomingKind === 'proposal' && proposalInfo) {
      return {
        kind: 'proposal',
        epoch: Number(this.state.groupContext.epoch),
        proposalType: proposalInfo.proposal.proposalType === 'add' ? 'add' : 'remove',
        proposer: proposalInfo.proposer,
        isExternal: false,
      };
    }

    return {
      kind: 'commit',
      epoch: Number(this.state.groupContext.epoch),
      membershipChange: null, // best-effort for this spike, see note in stageCommit
    };
  }

  async encrypt(envelope: PlaintextEnvelope): Promise<Uint8Array> {
    const impl = await getImpl();
    const plaintext = new TextEncoder().encode(JSON.stringify(envelope));
    const result = await createApplicationMessage(this.state, plaintext, impl);
    this.state = result.newState;
    return packEnvelope({
      conversationId: this.conversationId,
      mls: bytesToBase64(
        encodeMlsMessage({
          privateMessage: result.privateMessage,
          wireformat: 'mls_private_message',
          version: 'mls10',
        }),
      ),
    });
  }

  async stageCommit(change: MembershipChangeRequest): Promise<{
    wireBytes: Uint8Array;
    expectedEpoch: Epoch;
    welcomes: Array<{ deviceId: DeviceId; welcomeBytes: Uint8Array }>;
  }> {
    const impl = await getImpl();
    const expectedEpoch = Number(this.state.groupContext.epoch);

    const addedKeyPackages: Array<{
      deviceId: DeviceId;
      keyPackage: KeyPackage;
      keyPackageId: string;
    }> = [];
    const extraProposals: Proposal[] = [];

    for (const offer of change.added) {
      const envelope = unpackEnvelope(offer.keyPackage);
      const decoded = decodeMlsMessage(base64ToBytes(envelope.mls), 0)?.[0];
      if (!decoded || decoded.wireformat !== 'mls_key_package') {
        throw new CredentialMismatchError('Offered bytes are not a valid key package');
      }
      if (!envelope.keyPackageId) {
        throw new CredentialMismatchError('Offered key package is missing its id');
      }
      const embeddedCredential = decoded.keyPackage.leafNode.credential;
      if (embeddedCredential.credentialType !== 'basic') {
        throw new CredentialMismatchError('Only basic credentials are supported');
      }
      const identity = decodeIdentity(embeddedCredential.identity);
      if (
        identity.userId !== offer.credential.userId ||
        identity.deviceId !== offer.credential.deviceId
      ) {
        throw new CredentialMismatchError(
          `Key package identity (${identity.userId}/${identity.deviceId}) does not match the offered credential (${offer.credential.userId}/${offer.credential.deviceId})`,
        );
      }
      addedKeyPackages.push({
        deviceId: offer.credential.deviceId,
        keyPackage: decoded.keyPackage,
        keyPackageId: envelope.keyPackageId,
      });
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

    const wireBytes = packEnvelope({
      conversationId: this.conversationId,
      mls: bytesToBase64(encodeMlsMessage(commitResult.commit)),
    });

    const welcomes: Array<{ deviceId: DeviceId; welcomeBytes: Uint8Array }> = [];
    if (commitResult.welcome && addedKeyPackages.length > 0) {
      const encodedWelcome = bytesToBase64(
        encodeMlsMessage({
          welcome: commitResult.welcome,
          wireformat: 'mls_welcome',
          version: 'mls10',
        }),
      );
      const encodedTree = bytesToBase64(encodeRatchetTree(commitResult.newState.ratchetTree));

      for (const added of addedKeyPackages) {
        welcomes.push({
          deviceId: added.deviceId,
          welcomeBytes: packEnvelope({
            conversationId: this.conversationId,
            mls: encodedWelcome,
            ratchetTree: encodedTree,
            // the joiner resolves this against ITS OWN keyPackagesById map -
            // round-tripped from the same id generateKeyPackages() tagged the
            // offer with. Cannot be signaturePublicKey: that's now shared
            // across all of a device's key packages (see the identity-key
            // reuse fix above), so it can no longer identify *which* one.
            keyPackageId: added.keyPackageId,
          }),
        });
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
      new TextEncoder().encode(conversationId),
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
    const envelope = unpackEnvelope(welcomeBytes);
    if (envelope.conversationId !== conversationId) {
      throw new CredentialMismatchError(
        `Welcome is for conversation "${envelope.conversationId}", not "${conversationId}"`,
      );
    }
    if (!envelope.ratchetTree || !envelope.keyPackageId) {
      throw new CredentialMismatchError('Malformed Welcome envelope');
    }

    // getOwnCredential() is also what triggers the store's lazy hydration
    // from persistent storage - must run before keyPackagesById is read
    // directly below, or a freshly-constructed (not yet hydrated) store
    // would always report "no matching key package" after a reload.
    const credential = await this.store.getOwnCredential();
    const matching = this.store.keyPackagesById.get(envelope.keyPackageId);
    if (!matching) {
      throw new CredentialMismatchError(
        'This Welcome is not addressed to any key package this device holds',
      );
    }

    const impl = await getImpl();
    const decoded = decodeMlsMessage(base64ToBytes(envelope.mls), 0)?.[0];
    if (!decoded || decoded.wireformat !== 'mls_welcome') {
      throw new CredentialMismatchError('Envelope does not contain a Welcome message');
    }
    const tree = decodeRatchetTree(base64ToBytes(envelope.ratchetTree), 0)?.[0] as
      | RatchetTree
      | undefined;
    if (!tree) {
      throw new CredentialMismatchError('Malformed ratchet tree in Welcome envelope');
    }

    const state = await joinGroup(
      decoded.welcome,
      matching.publicPackage,
      matching.privatePackage,
      emptyPskIndex,
      impl,
      tree,
    );

    return new TsMlsGroupSession(conversationId, state, credential);
  }

  private pickOwnKeyPackage() {
    const first = [...this.store.keyPackagesById.values()][0];
    if (!first) {
      throw new Error('Device has no key packages - call provision() first');
    }
    return first;
  }
}

export const tsMlsCandidate: MlsClientCandidate = {
  name: 'ts-mls',
  createDeviceIdentityStore: () => new TsMlsDeviceIdentityStore(),
  createGroupSessionFactory: (store) =>
    new TsMlsGroupSessionFactory(store as TsMlsDeviceIdentityStore),
};
