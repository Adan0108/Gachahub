import { bytesEqual } from '../bytes';
import type { DeviceCredential, UserId } from '../contract/types';

const DEVICE_LABEL = 'gachahub-safety-device-v1';
const USER_LABEL = 'gachahub-safety-user-v1';
const PAIR_LABEL = 'gachahub-safety-pair-v1';
const GROUP_COUNT = 12;
const GROUP_MODULUS = 100_000n;

const encoder = new TextEncoder();

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function lengthPrefixed(bytes: Uint8Array): Uint8Array {
  return concat([u32(bytes.length), bytes]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Bytewise lexicographic order, shorter first on a shared prefix. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  }
  return a.length - b.length;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data.slice()));
}

/** SHA-256 over the domain label, user id, device id and signature key of one device. */
export async function deviceFingerprint(
  userId: UserId,
  deviceId: string,
  signatureKey: Uint8Array,
): Promise<Uint8Array> {
  return sha256(
    concat([
      lengthPrefixed(encoder.encode(DEVICE_LABEL)),
      lengthPrefixed(encoder.encode(userId)),
      lengthPrefixed(encoder.encode(deviceId)),
      lengthPrefixed(signatureKey),
    ]),
  );
}

/** One hash over a user's device fingerprints, independent of order and duplicates. */
export async function userFingerprint(deviceFingerprints: Uint8Array[]): Promise<Uint8Array> {
  const sorted = [...deviceFingerprints].sort(compareBytes);
  const unique = sorted.filter((fp, i) => i === 0 || !bytesEqual(fp, sorted[i - 1] as Uint8Array));
  return sha256(
    concat([lengthPrefixed(encoder.encode(USER_LABEL)), u32(unique.length), ...unique.map(lengthPrefixed)]),
  );
}

/** A user's fingerprint from the devices they have in a group, or undefined when they have none. */
export async function fingerprintFromLeaves(
  userId: UserId,
  leaves: DeviceCredential[],
): Promise<Uint8Array | undefined> {
  const mine = leaves.filter((leaf) => leaf.userId === userId);
  if (!mine.length) return undefined;
  return userFingerprint(await Promise.all(mine.map((l) => deviceFingerprint(userId, l.deviceId, l.signatureKey))));
}

/** One number both sides compute identically: the two fingerprints in sorted order, hashed. */
export async function pairFingerprint(a: Uint8Array, b: Uint8Array): Promise<Uint8Array> {
  const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(
    concat([lengthPrefixed(encoder.encode(PAIR_LABEL)), lengthPrefixed(first), lengthPrefixed(second)]),
  );
}

/** 60 decimal digits (12 groups of 5) taken from the low end of the 256-bit hash. */
export function formatSafetyNumber(hash: Uint8Array): string {
  let rest = 0n;
  for (const byte of hash) rest = (rest << 8n) | BigInt(byte);
  const groups: string[] = [];
  for (let i = 0; i < GROUP_COUNT; i += 1) {
    groups.push((rest % GROUP_MODULUS).toString().padStart(5, '0'));
    rest /= GROUP_MODULUS;
  }
  return groups.join(' ');
}

export function fingerprintToHex(hash: Uint8Array): string {
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
