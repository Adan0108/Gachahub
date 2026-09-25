import { createHmac, timingSafeEqual } from 'node:crypto';
import { BACKUP_PROOF_DOMAINS } from './chat-backup.constants';

export type ProofAction = keyof typeof BACKUP_PROOF_DOMAINS;

/** Proof: HMAC-SHA256 keyed by the replaceSecret (derived from the backup key), over JSON [action domain, userId, nonce, keyCheck, replaceSecret], answering a single-use 5-minute nonce; keyCheck and replaceSecret are the new key's for a replace and empty otherwise. */
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
