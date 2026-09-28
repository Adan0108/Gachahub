import { bytesToBase64 } from '../mls/storage/base64';
import { deserializeFromBytes, serializeToBytes } from '../mls/storage/mlsEncryptedStore';
import type { DecryptedMessage } from '../mls/storage/messagePlaintextStore';

const BLOB_VERSION = 1;
const NONCE_BYTES = 12;
const KEY_CHECK_TEXT = 'gachahub-backup-key-check';

/** What one blob holds; conversationId and messageId ride outside it, bound in by the AAD. */
export type BackupPayload = Pick<DecryptedMessage, 'senderDeviceId' | 'epoch' | 'envelope'>;

export interface BlobBinding {
  userId: string;
  conversationId: string;
  messageId: string;
}

export function importBackupKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw.slice(), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// JSON-encoded so no id can smuggle a delimiter into a neighbouring field.
const aad = (...parts: string[]) => new TextEncoder().encode(JSON.stringify(parts));

async function seal(key: CryptoKey, plaintext: Uint8Array, additionalData: Uint8Array) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce.slice(), additionalData: additionalData.slice() },
    key,
    plaintext.slice(),
  );
  const out = new Uint8Array(1 + NONCE_BYTES + sealed.byteLength);
  out[0] = BLOB_VERSION;
  out.set(nonce, 1);
  out.set(new Uint8Array(sealed), 1 + NONCE_BYTES);
  return out;
}

async function open(key: CryptoKey, blob: Uint8Array, additionalData: Uint8Array) {
  if (blob[0] !== BLOB_VERSION || blob.length <= 1 + NONCE_BYTES) {
    throw new Error('Unsupported backup blob');
  }
  const nonce = blob.slice(1, 1 + NONCE_BYTES);
  const sealed = blob.slice(1 + NONCE_BYTES);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: additionalData.slice() },
      key,
      sealed,
    ),
  );
}

const blobAad = ({ userId, conversationId, messageId }: BlobBinding) =>
  aad('gachahub-backup-v1', userId, conversationId, messageId);

export function encryptBlob(key: CryptoKey, binding: BlobBinding, payload: BackupPayload) {
  return seal(key, serializeToBytes(payload), blobAad(binding));
}

/** Throws if the key is wrong or the blob was moved to a different user, conversation or message. */
export async function decryptBlob(
  key: CryptoKey,
  binding: BlobBinding,
  blob: Uint8Array,
): Promise<BackupPayload> {
  return deserializeFromBytes<BackupPayload>(await open(key, blob, blobAad(binding)));
}

const keyCheckAad = (userId: string) => aad('gachahub-backup-key-check-v1', userId);

export function makeKeyCheck(key: CryptoKey, userId: string): Promise<Uint8Array> {
  return seal(key, new TextEncoder().encode(KEY_CHECK_TEXT), keyCheckAad(userId));
}

export async function verifyKeyCheck(
  key: CryptoKey,
  userId: string,
  keyCheck: Uint8Array,
): Promise<boolean> {
  try {
    const plain = await open(key, keyCheck, keyCheckAad(userId));
    return new TextDecoder().decode(plain) === KEY_CHECK_TEXT;
  } catch {
    return false;
  }
}

const REPLACE_SECRET_DOMAIN = 'gachahub-backup-replace-secret-v1';
const PROOF_DOMAINS = {
  replace: 'gachahub-backup-replace-v1',
  delete: 'gachahub-backup-delete-v1',
  'cancel-delete': 'gachahub-backup-cancel-delete-v1',
} as const;

export type ProofAction = keyof typeof PROOF_DOMAINS;

/** Stored server-side to verify a replace proof; one-way, so it reveals nothing about the backup key. */
export async function deriveReplaceSecret(rawKey: Uint8Array): Promise<Uint8Array> {
  const domain = new TextEncoder().encode(REPLACE_SECRET_DOMAIN);
  const input = new Uint8Array(domain.length + rawKey.length);
  input.set(domain);
  input.set(rawKey, domain.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

/** Base64 HMAC-SHA256 over JSON [action domain, userId, nonce, keyCheck, replaceSecret]; keyCheck and replaceSecret are the new key's for a replace and empty otherwise. Mirrors the backend's replace-proof.ts. */
export async function computeBackupProof(
  secret: Uint8Array,
  action: ProofAction,
  parts: { userId: string; nonce: string; keyCheck?: string; replaceSecret?: string },
): Promise<string> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    secret.slice(),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = JSON.stringify([
    PROOF_DOMAINS[action],
    parts.userId,
    parts.nonce,
    parts.keyCheck ?? '',
    parts.replaceSecret ?? '',
  ]);
  const mac = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(message));
  return bytesToBase64(new Uint8Array(mac));
}
