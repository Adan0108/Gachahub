const KEY_BYTES = 32;
const CHECKSUM_BYTES = 8;
const GROUP_SIZE = 8;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ENCODED_LENGTH = ((KEY_BYTES + CHECKSUM_BYTES) * 8) / 5;

export type RecoveryKeyProblem = 'length' | 'characters' | 'checksum';

export class RecoveryKeyError extends Error {
  constructor(public readonly problem: RecoveryKeyProblem) {
    super(`Invalid recovery key: ${problem}`);
    this.name = 'RecoveryKeyError';
  }
}

export function generateBackupKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

async function checksum(key: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', key.slice());
  return new Uint8Array(digest).slice(0, CHECKSUM_BYTES);
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

function base32Decode(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Not a base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

/** 64 base32 characters in 8 groups of 8: the 256-bit key plus a 64-bit checksum that catches typos. */
export async function formatRecoveryKey(key: Uint8Array): Promise<string> {
  const payload = new Uint8Array(KEY_BYTES + CHECKSUM_BYTES);
  payload.set(key);
  payload.set(await checksum(key), KEY_BYTES);
  return base32Encode(payload)
    .match(new RegExp(`.{${GROUP_SIZE}}`, 'g'))!
    .join('-');
}

// The alphabet has no 0, 1 or 8, so a typed one means the look-alike letter.
const LOOK_ALIKES: Record<string, string> = { '0': 'O', '1': 'I', '8': 'B' };

/** Tolerates case, spaces, dashes and the look-alikes 0/1/8; throws RecoveryKeyError with the reason otherwise. */
export async function parseRecoveryKey(text: string): Promise<Uint8Array> {
  const normalized = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[018]/g, (char) => LOOK_ALIKES[char]!);
  if (![...normalized].every((char) => ALPHABET.includes(char))) {
    throw new RecoveryKeyError('characters');
  }
  if (normalized.length !== ENCODED_LENGTH) {
    throw new RecoveryKeyError('length');
  }
  const payload = base32Decode(normalized);
  const key = payload.slice(0, KEY_BYTES);
  const expected = await checksum(key);
  if (!expected.every((byte, i) => byte === payload[KEY_BYTES + i])) {
    throw new RecoveryKeyError('checksum');
  }
  return key;
}
