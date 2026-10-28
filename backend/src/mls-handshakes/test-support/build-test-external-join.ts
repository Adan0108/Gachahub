import {
  createGroup,
  createGroupInfoWithExternalPubAndRatchetTree,
  defaultCapabilities,
  encodeMlsMessage,
  generateKeyPackage,
  generateKeyPackageWithKey,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroupExternal,
  type CiphersuiteImpl,
  type GroupInfo,
} from 'ts-mls';
import { PINNED_CIPHERSUITE } from '../../chat-devices/mls-key-package.util';

function getImpl(): Promise<CiphersuiteImpl> {
  return getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
}

function lifetime() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return { notBefore: now, notAfter: now + BigInt(90 * 24 * 60 * 60) };
}

async function newMember(identity: object) {
  return generateKeyPackage(
    {
      credentialType: 'basic',
      identity: new TextEncoder().encode(JSON.stringify(identity)),
    },
    defaultCapabilities(),
    lifetime(),
    [],
    await getImpl(),
  );
}

function encodeGroupInfo(groupInfo: GroupInfo): Uint8Array {
  return encodeMlsMessage({
    groupInfo,
    wireformat: 'mls_group_info',
    version: 'mls10',
  });
}

export interface TestExternalJoin {
  /** The epoch the group was at: what the joiner submits as `epoch`. */
  epoch: number;
  /** The snapshot the joiner built its commit from. */
  groupInfoPayload: Uint8Array;
  /** Encoded mls_public_message: the external commit. */
  commitPayload: Uint8Array;
  /** The snapshot for the epoch the join creates. */
  nextGroupInfoPayload: Uint8Array;
  joinerSignatureKey: Uint8Array;
}

/** Builds a real external commit: a device joining a one-member group for `conversationId` by itself. */
export async function buildTestExternalJoin(
  conversationId: string,
  joiner: { userId: string; deviceId: string },
): Promise<TestExternalJoin> {
  const impl = await getImpl();
  const creator = await newMember({
    userId: 'creator',
    deviceId: 'creator-device',
  });
  const joinerPackage = await newMember(joiner);

  const state = await createGroup(
    new TextEncoder().encode(conversationId),
    creator.publicPackage,
    creator.privatePackage,
    [],
    impl,
  );
  const groupInfo = await createGroupInfoWithExternalPubAndRatchetTree(
    state,
    [],
    impl,
  );

  const { publicMessage, newState } = await joinGroupExternal(
    groupInfo,
    joinerPackage.publicPackage,
    joinerPackage.privatePackage,
    false,
    impl,
  );

  return {
    epoch: Number(state.groupContext.epoch),
    groupInfoPayload: encodeGroupInfo(groupInfo),
    commitPayload: encodeMlsMessage({
      publicMessage,
      wireformat: 'mls_public_message',
      version: 'mls10',
    }),
    nextGroupInfoPayload: encodeGroupInfo(
      await createGroupInfoWithExternalPubAndRatchetTree(newState, [], impl),
    ),
    joinerSignatureKey: joinerPackage.publicPackage.leafNode.signaturePublicKey,
  };
}

export interface TestExternalResync extends TestExternalJoin {
  /** The leaf the commit removes: the device's own old leaf. */
  removedLeafIndex: number;
}

/** Builds a real resync: a device that is already a leaf of a two-member group joins it again, replacing that leaf. */
export async function buildTestExternalResync(
  conversationId: string,
  device: { userId: string; deviceId: string },
): Promise<TestExternalResync> {
  const impl = await getImpl();
  const creator = await newMember({
    userId: 'creator',
    deviceId: 'creator-device',
  });
  const old = await newMember(device);

  const created = await createGroup(
    new TextEncoder().encode(conversationId),
    creator.publicPackage,
    creator.privatePackage,
    [],
    impl,
  );
  const firstInfo = await createGroupInfoWithExternalPubAndRatchetTree(
    created,
    [],
    impl,
  );
  const joined = await joinGroupExternal(
    firstInfo,
    old.publicPackage,
    old.privatePackage,
    false,
    impl,
  );
  const state = joined.newState;
  const groupInfo = await createGroupInfoWithExternalPubAndRatchetTree(
    state,
    [],
    impl,
  );

  // Same device identity and signing key, fresh encryption keys: what a device that lost its state has
  const signatureKey = old.publicPackage.leafNode.signaturePublicKey;
  const fresh = await generateKeyPackageWithKey(
    {
      credentialType: 'basic',
      identity: new TextEncoder().encode(JSON.stringify(device)),
    },
    defaultCapabilities(),
    lifetime(),
    [],
    {
      signKey: old.privatePackage.signaturePrivateKey,
      publicKey: signatureKey,
    },
    impl,
  );

  const { publicMessage, newState } = await joinGroupExternal(
    groupInfo,
    fresh.publicPackage,
    fresh.privatePackage,
    true,
    impl,
  );

  return {
    epoch: Number(state.groupContext.epoch),
    groupInfoPayload: encodeGroupInfo(groupInfo),
    commitPayload: encodeMlsMessage({
      publicMessage,
      wireformat: 'mls_public_message',
      version: 'mls10',
    }),
    nextGroupInfoPayload: encodeGroupInfo(
      await createGroupInfoWithExternalPubAndRatchetTree(newState, [], impl),
    ),
    joinerSignatureKey: signatureKey,
    removedLeafIndex: 1,
  };
}
