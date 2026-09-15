import {
  defaultCapabilities,
  encodeMlsMessage,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  type Credential,
  type CiphersuiteName,
  type Lifetime,
} from 'ts-mls';
import { PINNED_CIPHERSUITE } from '../mls-key-package.util';

export function encodeTestIdentity(
  userId: string,
  deviceId: string,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ userId, deviceId }));
}

// ts-mls's own defaultLifetime is notBefore=0/notAfter=max-int64 - not
// something a real client should ever send. Tests use a genuinely bounded
// one so they exercise the same shape of key package production code does.
export function boundedTestLifetime(days = 30): Lifetime {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return { notBefore: now, notAfter: now + BigInt(days * 24 * 60 * 60) };
}

export interface TestKeyPackage {
  payload: Uint8Array;
  /** The signature key actually embedded in this key package's leaf node. */
  signaturePublicKey: Uint8Array;
}

/** Builds a real, validly-signed MLS key package for use in tests. */
export async function buildTestKeyPackage(
  userId: string,
  deviceId: string,
  options: { ciphersuite?: CiphersuiteName; lifetime?: Lifetime } = {},
): Promise<TestKeyPackage> {
  const impl = await getCiphersuiteImpl(
    getCiphersuiteFromName(options.ciphersuite ?? PINNED_CIPHERSUITE),
  );
  const credential: Credential = {
    credentialType: 'basic',
    identity: encodeTestIdentity(userId, deviceId),
  };
  const kp = await generateKeyPackage(
    credential,
    defaultCapabilities(),
    options.lifetime ?? boundedTestLifetime(),
    [],
    impl,
  );
  return {
    payload: encodeMlsMessage({
      keyPackage: kp.publicPackage,
      wireformat: 'mls_key_package',
      version: 'mls10',
    }),
    signaturePublicKey: kp.publicPackage.leafNode.signaturePublicKey,
  };
}
