import { BadRequestException } from '@nestjs/common';
import {
  decodeMlsMessage,
  getCiphersuiteImpl,
  getCiphersuiteFromName,
  type CiphersuiteImpl,
  type KeyPackage,
} from 'ts-mls';
// Not re-exported from the package root - reachable via ts-mls's own
// "./*.js" subpath export map (same as the frontend adapter).
import { verifyKeyPackage } from 'ts-mls/keyPackage.js';
import { bytesEqual } from '../common/utils/bytes';

/**
 * Ciphersuite this backend accepts for MLS key packages - matches the
 * frontend's ts-mls adapter (frontend/lib/mls/tsMlsAdapter.ts). Pinned to
 * exactly one (critique C1) rather than accepting whatever a client sends,
 * so uploads can never mix ciphersuites.
 */
export const PINNED_CIPHERSUITE =
  'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

const MAX_KEY_PACKAGE_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
// A key package that isn't valid yet is still useless to us today - allow
// only a small clock-skew tolerance, not a package scheduled to activate
// far in the future.
const CLOCK_SKEW_TOLERANCE_SECONDS = 5 * 60;

let cachedImpl: Promise<CiphersuiteImpl> | undefined;
function getImpl(): Promise<CiphersuiteImpl> {
  cachedImpl ??= getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
  return cachedImpl;
}

export interface ExpectedKeyPackageIdentity {
  userId: string;
  deviceId: string;
  /**
   * The device's claimed long-term identity signing key. Every key package
   * a well-behaved device produces reuses this same key (see the frontend
   * adapter's signatureKeyPair reuse fix) - checking it here catches a
   * device whose registered signaturePublicKey has no actual relationship
   * to the key its key packages are really signed with.
   */
  signaturePublicKey: Uint8Array;
}

/**
 * Decodes and fully validates an uploaded MLS key package: real wire
 * format, real signature, pinned ciphersuite, a bounded lifetime, and a
 * credential that actually matches who the upload claims to be from
 * (threat-model §1 / critique C1's upload checks). Throws
 * BadRequestException on any failure - callers don't need a separate
 * validation pass.
 */
export async function decodeAndVerifyKeyPackage(
  payload: Uint8Array,
  expected: ExpectedKeyPackageIdentity,
): Promise<KeyPackage> {
  try {
    return await decodeAndVerifyKeyPackageUnsafe(payload, expected);
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    // ts-mls's decoder throws (CodecError and friends) on truncated/
    // malformed binary input instead of returning undefined - without this,
    // adversarial bytes on this endpoint surface as an unhandled 500
    // (and fire the Discord error alert) instead of a clean 400. Never
    // include the raw error/stack in the response - threat-model §7.
    throw new BadRequestException('Not a valid MLS key package');
  }
}

async function decodeAndVerifyKeyPackageUnsafe(
  payload: Uint8Array,
  expected: ExpectedKeyPackageIdentity,
): Promise<KeyPackage> {
  const decoded = decodeMlsMessage(payload, 0)?.[0];
  if (!decoded || decoded.wireformat !== 'mls_key_package') {
    throw new BadRequestException('Not a valid MLS key package');
  }

  const keyPackage = decoded.keyPackage;

  if (keyPackage.cipherSuite !== PINNED_CIPHERSUITE) {
    throw new BadRequestException(
      `Unsupported ciphersuite: expected ${PINNED_CIPHERSUITE}`,
    );
  }

  const impl = await getImpl();
  const isSignatureValid = await verifyKeyPackage(keyPackage, impl.signature);
  if (!isSignatureValid) {
    throw new BadRequestException('Key package signature is invalid');
  }

  const credential = keyPackage.leafNode.credential;
  if (credential.credentialType !== 'basic') {
    throw new BadRequestException('Only basic credentials are supported');
  }

  let identity: Partial<ExpectedKeyPackageIdentity>;
  try {
    identity = JSON.parse(
      new TextDecoder().decode(credential.identity),
    ) as Partial<ExpectedKeyPackageIdentity>;
  } catch {
    throw new BadRequestException('Key package credential is malformed');
  }

  if (
    identity.userId !== expected.userId ||
    identity.deviceId !== expected.deviceId
  ) {
    throw new BadRequestException(
      'Key package credential does not match the authenticated user/device',
    );
  }

  if (
    !bytesEqual(
      keyPackage.leafNode.signaturePublicKey,
      expected.signaturePublicKey,
    )
  ) {
    throw new BadRequestException(
      "Key package is not signed with this device's registered signature key",
    );
  }

  const { notBefore, notAfter } = keyPackage.leafNode.lifetime;
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const durationSeconds = Number(notAfter - notBefore);

  if (
    durationSeconds <= 0 ||
    durationSeconds > MAX_KEY_PACKAGE_LIFETIME_SECONDS
  ) {
    throw new BadRequestException(
      `Key package lifetime must be positive and at most ${MAX_KEY_PACKAGE_LIFETIME_SECONDS} seconds`,
    );
  }

  // Duration alone isn't enough: a package with an 89-day span starting
  // 300 days from now would pass that check but isn't valid yet. Once this
  // holds, notAfter is automatically bounded too (notAfter = notBefore +
  // duration <= (now + skew) + MAX), so no separate absolute-notAfter
  // check is needed on top of it.
  if (notBefore > nowSeconds + BigInt(CLOCK_SKEW_TOLERANCE_SECONDS)) {
    throw new BadRequestException(
      'Key package is not valid yet (notBefore is in the future)',
    );
  }

  return keyPackage;
}
