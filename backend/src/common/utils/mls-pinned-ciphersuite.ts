import {
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  type CiphersuiteImpl,
} from 'ts-mls';

/**
 * Ciphersuite this backend accepts for MLS key packages - matches the
 * frontend's ts-mls adapter (frontend/lib/mls/tsMlsAdapter.ts). Pinned to
 * exactly one (critique C1) rather than accepting whatever a client sends,
 * so uploads can never mix ciphersuites.
 */
export const PINNED_CIPHERSUITE =
  'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

let cachedImpl: Promise<CiphersuiteImpl> | undefined;

/** The one ciphersuite this server speaks, built once. */
export function getPinnedCiphersuiteImpl(): Promise<CiphersuiteImpl> {
  cachedImpl ??= getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
  return cachedImpl;
}
