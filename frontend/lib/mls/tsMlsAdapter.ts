import {
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeMlsMessage,
  encodeMlsMessage,
  encodeGroupState,
  decodeGroupState,
  generateKeyPackage,
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

/**
 * ts-mls adapter for the step 2 bake-off. Real crypto, real wire format -
 * this is what actually gets run against contractTests.ts, not a stub.
 *
 * Ciphersuite: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519, the one entry
 * in ts-mls's support table needing zero extra peer dependencies. Good
 * enough to prove the contract out; picking a final ciphersuite is a
 * separate decision once a library is actually chosen.
 */
const CIPHERSUITE_NAME = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

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

// btoa/atob, not Buffer - this adapter's real home is the browser, even
// though the bake-off runs it under Node via Vitest.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

interface StoredKeyPackage {
  id: string;
  publicPackage: KeyPackage;
  privatePackage: PrivateKeyPackage;
}

class TsMlsDeviceIdentityStore implements DeviceIdentityStore {
  private readonly deviceId: DeviceId = crypto.randomUUID();
  private credential: DeviceCredential | undefined;
  private nextKeyPackageId = 0;
  readonly keyPackagesById = new Map<string, StoredKeyPackage>();

  async isProvisioned(): Promise<boolean> {
    return this.credential !== undefined;
  }

  async provision(userId: UserId): Promise<DeviceCredential> {
    const impl = await getImpl();
    const mlsCredential: Credential = {
      credentialType: 'basic',
      identity: encodeIdentity(userId, this.deviceId),
    };
    const kp = await generateKeyPackage(
      mlsCredential,
      defaultCapabilities(),
      boundedLifetime(),
      [],
      impl,
    );
    this.storeKeyPackage(kp.publicPackage, kp.privatePackage);
    this.credential = {
      userId,
      deviceId: this.deviceId,
      signatureKey: kp.publicPackage.leafNode.signaturePublicKey,
    };
    return this.credential;
  }

  async getOwnCredential(): Promise<DeviceCredential> {
    if (!this.credential) {
      throw new Error('Device not provisioned yet');
    }
    return this.credential;
  }

  async generateKeyPackages(count: number): Promise<Uint8Array[]> {
    if (!this.credential) {
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
      const kp = await generateKeyPackage(
        mlsCredential,
        defaultCapabilities(),
        boundedLifetime(),
        [],
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
    return out;
  }

  async revoke(): Promise<void> {
    this.credential = undefined;
    this.keyPackagesById.clear();
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

    const addedKeyPackages: Array<{ deviceId: DeviceId; keyPackage: KeyPackage }> = [];
    const extraProposals: Proposal[] = [];

    for (const offer of change.added) {
      const envelope = unpackEnvelope(offer.keyPackage);
      const decoded = decodeMlsMessage(base64ToBytes(envelope.mls), 0)?.[0];
      if (!decoded || decoded.wireformat !== 'mls_key_package') {
        throw new CredentialMismatchError('Offered bytes are not a valid key package');
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
      addedKeyPackages.push({ deviceId: offer.credential.deviceId, keyPackage: decoded.keyPackage });
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
            // the joiner resolves this against ITS OWN keyPackagesById map, not
            // ours - it's an opaque tag round-tripped through generateKeyPackages
            keyPackageId: bytesToBase64(added.keyPackage.leafNode.signaturePublicKey),
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

class TsMlsGroupSessionFactory implements GroupSessionFactory {
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

    const matching = [...this.store.keyPackagesById.values()].find(
      (kp) =>
        bytesToBase64(kp.publicPackage.leafNode.signaturePublicKey) === envelope.keyPackageId,
    );
    if (!matching) {
      throw new CredentialMismatchError(
        'This Welcome is not addressed to any key package this device holds',
      );
    }

    const impl = await getImpl();
    const credential = await this.store.getOwnCredential();
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
