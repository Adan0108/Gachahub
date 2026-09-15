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

/**
 * Ciphersuite this backend accepts for MLS key packages - matches the
 * frontend's ts-mls adapter (frontend/lib/mls/tsMlsAdapter.ts). Pinned to
 * exactly one (critique C1) rather than accepting whatever a client sends,
 * so uploads can never mix ciphersuites.
 */
export const PINNED_CIPHERSUITE =
  'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

const MAX_KEY_PACKAGE_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

let cachedImpl: Promise<CiphersuiteImpl> | undefined;
function getImpl(): Promise<CiphersuiteImpl> {
  cachedImpl ??= getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
  return cachedImpl;
}

export interface ExpectedKeyPackageIdentity {
  userId: string;
  deviceId: string;
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

  const lifetimeSeconds = Number(
    keyPackage.leafNode.lifetime.notAfter -
      keyPackage.leafNode.lifetime.notBefore,
  );
  if (
    lifetimeSeconds <= 0 ||
    lifetimeSeconds > MAX_KEY_PACKAGE_LIFETIME_SECONDS
  ) {
    throw new BadRequestException(
      `Key package lifetime must be positive and at most ${MAX_KEY_PACKAGE_LIFETIME_SECONDS} seconds`,
    );
  }

  return keyPackage;
}
