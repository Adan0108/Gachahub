import {
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  type CiphersuiteImpl,
} from 'ts-mls';

/** The one ciphersuite accepted for MLS key packages; matches the frontend's ts-mls adapter. */
export const PINNED_CIPHERSUITE =
  'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

let cachedImpl: Promise<CiphersuiteImpl> | undefined;

/** The one ciphersuite this server speaks, built once. */
export function getPinnedCiphersuiteImpl(): Promise<CiphersuiteImpl> {
  cachedImpl ??= getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
  return cachedImpl;
}
