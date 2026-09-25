import {
  createApplicationMessage,
  createCommit,
  createGroup,
  defaultCapabilities,
  encodeMlsMessage,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  type CiphersuiteImpl,
  type Credential,
} from 'ts-mls';
import { PINNED_CIPHERSUITE } from '../../chat-devices/mls-key-package.util';

function boundedLifetime() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return { notBefore: now, notAfter: now + BigInt(90 * 24 * 60 * 60) };
}

function getImpl(): Promise<CiphersuiteImpl> {
  return getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
}

async function generateTestMember(identity: string) {
  const impl = await getImpl();
  const credential: Credential = {
    credentialType: 'basic',
    identity: new TextEncoder().encode(identity),
  };
  return generateKeyPackage(
    credential,
    defaultCapabilities(),
    boundedLifetime(),
    [],
    impl,
  );
}

export interface TestCommit {
  /** The epoch the group was at before this Commit - what a real client would submit as `epoch`. */
  epoch: number;
  /** Encoded mls_private_message wire bytes for the Commit itself. */
  commitPayload: Uint8Array;
  /** Encoded mls_welcome wire bytes for the member this Commit adds. */
  welcomePayload: Uint8Array;
}

/**
 * Builds a real, validly-signed MLS Commit (plus the Welcome it produces,
 * by adding one new member) for `conversationId` - used to exercise the
 * framing checks and handshake repository/service against real wire bytes
 * instead of hand-rolled fixtures.
 */
export async function buildTestCommitWithWelcome(
  conversationId: string,
): Promise<TestCommit> {
  const impl = await getImpl();
  const creator = await generateTestMember('creator');
  const joiner = await generateTestMember('joiner');

  const state = await createGroup(
    new TextEncoder().encode(conversationId),
    creator.publicPackage,
    creator.privatePackage,
    [],
    impl,
  );
  const epoch = Number(state.groupContext.epoch);

  const commitResult = await createCommit(
    { state, cipherSuite: impl },
    {
      extraProposals: [
        { proposalType: 'add', add: { keyPackage: joiner.publicPackage } },
      ],
      ratchetTreeExtension: true,
    },
  );

  if (!commitResult.welcome) {
    throw new Error('Expected a Welcome from a Commit that adds a member');
  }

  return {
    epoch,
    commitPayload: encodeMlsMessage(commitResult.commit),
    welcomePayload: encodeMlsMessage({
      welcome: commitResult.welcome,
      wireformat: 'mls_welcome',
      version: 'mls10',
    }),
  };
}

/**
 * Builds a real, validly-encrypted MLS application message for
 * `conversationId` - used to exercise assertIsApplicationMessage against
 * real wire bytes instead of a hand-rolled fixture.
 */
export async function buildTestApplicationMessage(
  conversationId: string,
): Promise<Uint8Array> {
  const impl = await getImpl();
  const sender = await generateTestMember('sender');

  const state = await createGroup(
    new TextEncoder().encode(conversationId),
    sender.publicPackage,
    sender.privatePackage,
    [],
    impl,
  );

  const result = await createApplicationMessage(
    state,
    new TextEncoder().encode('hello'),
    impl,
  );

  return encodeMlsMessage({
    privateMessage: result.privateMessage,
    wireformat: 'mls_private_message',
    version: 'mls10',
  });
}
