import { getCiphersuiteImpl, getCiphersuiteFromName, type CiphersuiteImpl } from 'ts-mls';
import type { ConversationId } from '../contract/types';

export const CIPHERSUITE_NAME = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

let cachedImpl: Promise<CiphersuiteImpl> | undefined;
export function getImpl(): Promise<CiphersuiteImpl> {
  cachedImpl ??= getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE_NAME));
  return cachedImpl;
}

export function encodeConversationId(conversationId: ConversationId): Uint8Array {
  return new TextEncoder().encode(conversationId);
}
