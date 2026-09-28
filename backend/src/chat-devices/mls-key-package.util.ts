import { BadRequestException } from '@nestjs/common';
import { decodeMlsMessage, type KeyPackage } from 'ts-mls';
// Not re-exported from the package root; reached via ts-mls's "./*.js" subpath export.
import { verifyKeyPackage } from 'ts-mls/keyPackage.js';
import { bytesEqual } from '../common/utils/bytes';
import {
  getPinnedCiphersuiteImpl,
  PINNED_CIPHERSUITE,
} from '../common/utils/mls-pinned-ciphersuite';

export { PINNED_CIPHERSUITE };

const MAX_KEY_PACKAGE_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
// Allows only a small clock-skew tolerance for a not-yet-valid package.
const CLOCK_SKEW_TOLERANCE_SECONDS = 5 * 60;

export interface ExpectedKeyPackageIdentity {
  userId: string;
  deviceId: string;
  /** The device's claimed long-term identity signing key; must match the key its key packages are signed with. */
  signaturePublicKey: Uint8Array;
}

/** Decodes and fully validates an uploaded key package; throws BadRequestException on any failure. */
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

    // Malformed bytes must surface as a 400, never leak the raw error.
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

  const impl = await getPinnedCiphersuiteImpl();
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

  // Duration alone is not enough: a future notBefore is not valid yet.
  if (notBefore > nowSeconds + BigInt(CLOCK_SKEW_TOLERANCE_SECONDS)) {
    throw new BadRequestException(
      'Key package is not valid yet (notBefore is in the future)',
    );
  }

  // A fully elapsed validity window needs its own check against now.
  if (notAfter <= nowSeconds) {
    throw new BadRequestException('Key package has already expired');
  }

  return keyPackage;
}
