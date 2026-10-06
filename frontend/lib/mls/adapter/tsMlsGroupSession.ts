import {
  createApplicationMessage,
  createCommit,
  createGroupInfoWithExternalPubAndRatchetTree,
  decodeMlsMessage,
  encodeMlsMessage,
  encodeGroupState,
  processPrivateMessage,
  processPublicMessage,
  emptyPskIndex,
  type CiphersuiteImpl,
  type ClientState,
  type RatchetTree,
  type LeafIndex,
  type Proposal,
  type PublicMessage,
} from 'ts-mls';
import { toNodeIndex, nodeToLeafIndex } from 'ts-mls/treemath.js';
import { decryptSenderData } from 'ts-mls/privateMessage.js';
import type { GroupSession } from '../contract/client';
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
import { bytesEqual } from '../bytes';
import { isAttachmentEnvelope } from '../media/attachmentEnvelope';
import { isEditEnvelope } from '../messaging/editEnvelope';
import { decodeIdentity } from './identityCodec';
import { diffLeafMembership, listLeafCredentials } from './leafMembership';
import { encodeConversationId, getImpl } from './tsMlsShared';

const BODY_ENVELOPE_TYPES = new Set(['text', 'delete', 'reaction']);

/** Guards against a malformed or version-mismatched decrypted payload rather than trusting contract/types.ts's shape via a bare cast. */
function isPlaintextEnvelope(value: unknown): value is PlaintextEnvelope {
  if (typeof value !== 'object' || value === null || (value as { v?: unknown }).v !== 1) {
    return false;
  }
  const { type } = value as { type?: unknown };
  if (type === 'attachment') return isAttachmentEnvelope(value);
  if (type === 'edit') return isEditEnvelope(value);
  return BODY_ENVELOPE_TYPES.has(type as string);
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

/** The public, signed snapshot other devices need to join a group by themselves. */
export async function encodeGroupInfoFor(state: ClientState, impl: CiphersuiteImpl): Promise<Uint8Array> {
  const groupInfo = await createGroupInfoWithExternalPubAndRatchetTree(state, [], impl);
  return encodeMlsMessage({ groupInfo, wireformat: 'mls_group_info', version: 'mls10' });
}

export class TsMlsGroupSession implements GroupSession {
  private staged: { newState: ClientState; welcome: Uint8Array | undefined } | undefined;

  constructor(
    public readonly conversationId: ConversationId,
    private state: ClientState,
    private readonly credential: DeviceCredential,
  ) {}

  async currentEpoch(): Promise<Epoch> {
    return Number(this.state.groupContext.epoch);
  }

  async listLeaves(): Promise<DeviceCredential[] | undefined> {
    return listLeafCredentials(this.state.ratchetTree);
  }

  async peekEpoch(wireBytes: Uint8Array): Promise<Epoch | undefined> {
    const decoded = decodeMlsMessage(wireBytes, 0)?.[0];
    if (decoded?.wireformat === 'mls_public_message') {
      const { groupId, epoch } = decoded.publicMessage.content;
      return bytesEqual(groupId, encodeConversationId(this.conversationId))
        ? Number(epoch)
        : undefined;
    }
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
    if (decoded?.wireformat === 'mls_public_message') {
      return this.processExternalCommit(decoded.publicMessage);
    }
    if (!decoded || decoded.wireformat !== 'mls_private_message') {
      return { kind: 'rejected', reason: 'malformed' };
    }

    if (!bytesEqual(decoded.privateMessage.groupId, encodeConversationId(this.conversationId))) {
      return { kind: 'rejected', reason: 'wrong-conversation' };
    }

    const impl = await getImpl();

    let incomingKind: 'commit' | 'proposal' | undefined;
    let proposalInfo:
      { proposal: Proposal; proposer: DeviceCredential; isExternal: boolean } | undefined;
    // A member-sent proposal whose credential didn't decode - distinct from proposalInfo being absent (e.g. this was a commit, not a proposal)
    let proposalCredentialMismatch = false;
    const treeBeforeCommit = this.state.ratchetTree;

    // A straggler from an epoch this device has already moved past (a peer's message landing
    // after this device applied a commit theirs raced with) still needs to decrypt - ts-mls itself
    // keeps a few old epochs' worth of key material for exactly this (historicalReceiverData) - but
    // its secret/tree belong to that epoch, not the current one. Using the current senderDataSecret
    // against an old-epoch message is a guaranteed AEAD failure (CryptoError: OperationError), not a
    // real rejection - the message just needed the right epoch's key, which is right here.
    //
    // A message from an epoch AHEAD of this device's own is deliberately left alone below (no
    // historical-style lookup exists for the future): a device that's merely behind will just
    // catch up on its next sync, and a member who was removed and can never catch up must keep
    // failing the same way it always has (a thrown crypto error), not resolve as a soft rejection.
    const messageEpoch = decoded.privateMessage.epoch;
    const currentEpoch = this.state.groupContext.epoch;
    let senderDataSecret = this.state.keySchedule.senderDataSecret;
    let senderLookupTree = treeBeforeCommit;
    if (messageEpoch < currentEpoch) {
      const historical = this.state.historicalReceiverData.get(messageEpoch);
      if (historical) {
        senderDataSecret = historical.senderDataSecret;
        senderLookupTree = historical.ratchetTree;
      }
      // No stored entry: genuinely outside retention - fall through with the current epoch's
      // secret/tree, same as before this fix, so the AEAD check below fails as it always did.
    }

    // SenderData is encrypted separately from the actual message content (a lighter, non-ratchet-consuming layer meant for exactly this kind of metadata lookup), so peeking at it here doesn't touch the per-generation keys processPrivateMessage still needs to consume right after - safe to decrypt both without double-consuming anything
    const senderData = await decryptSenderData(
      decoded.privateMessage,
      senderDataSecret,
      impl,
    );
    const senderNode =
      senderData !== undefined ? senderLookupTree[senderData.leafIndex * 2] : undefined;
    const senderIdentity =
      senderNode?.nodeType === 'leaf' && senderNode.leaf.credential.credentialType === 'basic'
        ? decodeIdentity(senderNode.leaf.credential.identity)
        : undefined;

    // Resolved from the tree as it stood BEFORE this message - no one-time key consumed yet - so an application message with an unidentifiable sender can be rejected here instead of after decrypting it, where there'd be no way to "undo" that consumption just to report the failure
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
          // Only a "member" sender has a leaf index (sender.d.ts) - a standalone proposal with none came through some other channel (external_senders, a new-member self-proposal/commit), none of which this app configures anywhere today
          const isExternal = senderLeaf === undefined;
          const senderNode = !isExternal ? treeBeforeCommit[senderLeaf * 2] : undefined;
          const proposerCredential =
            senderNode?.nodeType === 'leaf' && senderNode.leaf.credential.credentialType === 'basic'
              ? decodeIdentity(senderNode.leaf.credential.identity)
              : undefined;

          // A real member sent this (not external) but its credential isn't decodable - reporting it under a fabricated 'unknown' identity would silently defeat any pinning/safety-number check built on DeviceCredential.signatureKey
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

          // types.ts's ProcessResult.isExternal doc: a GroupSession MUST reject an external proposal whose proposalType is 'add' - a compromised server could otherwise insert an attacker's device through this channel
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
        // Guaranteed resolved: the early return above already rejected this message before processPrivateMessage ran if it weren't
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

  /** A device joining by itself sends a public commit */
  private async processExternalCommit(publicMessage: PublicMessage): Promise<ProcessResult> {
    const { content } = publicMessage;
    if (!bytesEqual(content.groupId, encodeConversationId(this.conversationId))) {
      return { kind: 'rejected', reason: 'wrong-conversation' };
    }
    if (content.sender.senderType !== 'new_member_commit' || content.contentType !== 'commit') {
      return { kind: 'rejected', reason: 'malformed' };
    }

    const treeBeforeCommit = this.state.ratchetTree;
    const result = await processPublicMessage(
      this.state,
      publicMessage,
      emptyPskIndex,
      await getImpl(),
    );
    this.state = result.newState;

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
    groupInfo: Uint8Array;
    welcome?: { deviceIds: DeviceId[]; welcomeBytes: Uint8Array };
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

    let welcome: { deviceIds: DeviceId[]; welcomeBytes: Uint8Array } | undefined;
    if (commitResult.welcome && addedDeviceIds.length > 0) {
      // One Welcome message carries secrets for every newly-added device at once (Welcome.secrets[], each entry a KeyPackageRef) - the same bytes are for every added device, and each recognizes its own entry itself (joinFromWelcome/findMatchingKeyPackage), same as a real MLS client would. ratchetTreeExtension: true above means the tree travels inside this Welcome's own GroupInfo - joinGroup recovers it from there, no separate out-of-band tree needed
      const welcomeBytes = encodeMlsMessage({
        welcome: commitResult.welcome,
        wireformat: 'mls_welcome',
        version: 'mls10',
      });
      welcome = { deviceIds: addedDeviceIds, welcomeBytes };
    }

    return {
      wireBytes,
      expectedEpoch,
      groupInfo: await encodeGroupInfoFor(commitResult.newState, impl),
      welcome,
    };
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
