import { bytesEqual } from '../bytes';
import { base64ToBytes, bytesToBase64 } from '../storage/base64';
import type { EncryptedBlobRef } from '../contract/types';
import { GCM_TAG_BYTES, MAX_ATTACHMENT_BYTES } from './limits';

const KEY_BYTES = 32;
const IV_BYTES = 12;

export type AttachmentErrorCode = 'too-large' | 'integrity' | 'malformed';

export class AttachmentError extends Error {
  constructor(
    readonly code: AttachmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentError';
  }
}

export type BlobKeyMaterial = Pick<EncryptedBlobRef, 'key' | 'iv' | 'sha256'>;

export interface EncryptedAttachment extends BlobKeyMaterial {
  ciphertext: Uint8Array;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function importKey(rawKey: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, [usage]);
}

/** A fresh random key and IV per file - a key is never reused, so the IV can safely be random. */
export function generateKeyMaterial(): { key: Uint8Array; iv: Uint8Array } {
  return {
    key: crypto.getRandomValues(new Uint8Array(KEY_BYTES)),
    iv: crypto.getRandomValues(new Uint8Array(IV_BYTES)),
  };
}

export async function encryptAttachment(
  plaintext: Uint8Array,
  maxBytes: number = MAX_ATTACHMENT_BYTES,
): Promise<EncryptedAttachment> {
  if (plaintext.byteLength > maxBytes) {
    throw new AttachmentError('too-large', 'File is too large to send');
  }

  const { key, iv } = generateKeyMaterial();
  const cryptoKey = await importKey(key, 'encrypt');
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      cryptoKey,
      plaintext as BufferSource,
    ),
  );

  return {
    ciphertext,
    key: bytesToBase64(key),
    iv: bytesToBase64(iv),
    sha256: bytesToBase64(await sha256(plaintext)),
  };
}

function decodeExact(value: string, length: number): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    throw new AttachmentError('malformed', 'Attachment key material is not valid base64');
  }
  if (bytes.length !== length) {
    throw new AttachmentError('malformed', 'Attachment key material has the wrong length');
  }
  return bytes;
}

/** Decrypts, then checks the plaintext hash from the envelope - GCM alone would not catch a swapped (key, blob) pair. */
export async function decryptAttachment(
  ciphertext: Uint8Array,
  material: BlobKeyMaterial,
  maxBytes: number = MAX_ATTACHMENT_BYTES,
): Promise<Uint8Array> {
  if (ciphertext.byteLength > maxBytes + GCM_TAG_BYTES) {
    throw new AttachmentError('too-large', 'Encrypted file is larger than allowed');
  }

  const key = decodeExact(material.key, KEY_BYTES);
  const iv = decodeExact(material.iv, IV_BYTES);
  const expectedHash = decodeExact(material.sha256, 32);

  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        await importKey(key, 'decrypt'),
        ciphertext as BufferSource,
      ),
    );
  } catch {
    throw new AttachmentError('integrity', 'File could not be decrypted');
  }

  if (!bytesEqual(await sha256(plaintext), expectedHash)) {
    throw new AttachmentError('integrity', 'File does not match its checksum');
  }

  return plaintext;
}
