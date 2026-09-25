import { getCiphersuiteImpl, getCiphersuiteFromName, type CiphersuiteImpl } from 'ts-mls';
import type { ConversationId } from '../contract/types';

/**
 * ts-mls adapter for the step 2 bake-off. Real crypto, real wire format -
 * this is what actually gets run against contractTests.ts, not a stub.
 *
 * Ciphersuite: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519, the one entry
 * in ts-mls's support table needing zero extra peer dependencies. Good
 * enough to prove the contract out; picking a final ciphersuite is a
 * separate decision once a library is actually chosen.
 */
export const CIPHERSUITE_NAME = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

let cachedImpl: Promise<CiphersuiteImpl> | undefined;
export function getImpl(): Promise<CiphersuiteImpl> {
  cachedImpl ??= getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE_NAME));
  return cachedImpl;
}

export function encodeConversationId(conversationId: ConversationId): Uint8Array {
  return new TextEncoder().encode(conversationId);
}
