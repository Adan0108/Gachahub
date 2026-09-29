import { createHmac, timingSafeEqual } from 'node:crypto';
import { BACKUP_PROOF_DOMAINS } from './chat-backup.constants';

export type ProofAction = keyof typeof BACKUP_PROOF_DOMAINS;

/** HMAC-SHA256 proof keyed by replaceSecret over a single-use 5-minute nonce; keyCheck/replaceSecret are the new key's on replace, empty otherwise. */
export function computeBackupProof(
  secret: Uint8Array,
  action: ProofAction,
  parts: {
    userId: string;
    nonce: string;
    keyCheck?: string;
    replaceSecret?: string;
  },
): Buffer {
  return createHmac('sha256', secret)
    .update(
      JSON.stringify([
        BACKUP_PROOF_DOMAINS[action],
        parts.userId,
        parts.nonce,
        parts.keyCheck ?? '',
        parts.replaceSecret ?? '',
      ]),
    )
    .digest();
}

export function proofMatches(expected: Buffer, given: Buffer): boolean {
  return expected.length === given.length && timingSafeEqual(expected, given);
}
