export const MAX_BLOB_BYTES = 64 * 1024;
export const MAX_BATCH_ITEMS = 100;
export const USER_QUOTA_BYTES = 100 * 1024 * 1024;
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 100;
// Bounds for the key-check ciphertext: nonce + short fixed string + tag.
export const MIN_KEY_CHECK_BYTES = 16;
export const MAX_KEY_CHECK_BYTES = 256;
export const MAX_SECRET_BYTES = 64;
export const CHALLENGE_NONCE_BYTES = 32;
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const BACKUP_PROOF_DOMAINS = {
  replace: 'gachahub-backup-replace-v1',
  delete: 'gachahub-backup-delete-v1',
  'cancel-delete': 'gachahub-backup-cancel-delete-v1',
} as const;
export const DELETION_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DELETIONS_PER_RUN = 500;
export const MIN_SECRET_BYTES = 16;
