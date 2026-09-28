import { describe, expect, it } from 'vitest';
import {
  compareBytes,
  deviceFingerprint,
  fingerprintFromLeaves,
  fingerprintToHex,
  formatSafetyNumber,
  pairFingerprint,
  userFingerprint,
} from './safetyNumber';
import type { DeviceCredential } from '../contract/types';

const key = (...bytes: number[]) => new Uint8Array(bytes);
const leaf = (userId: string, deviceId: string, signatureKey: Uint8Array): DeviceCredential => ({
  userId,
  deviceId,
  signatureKey,
});

describe('formatSafetyNumber', () => {
  it('renders 12 groups of 5 digits', () => {
    const digits = formatSafetyNumber(new Uint8Array(32).fill(255));
    expect(digits).toMatch(/^(\d{5} ){11}\d{5}$/);
  });

  it('encodes the hash as base-100000 groups, lowest group first', () => {
    const hash = new Uint8Array(32);
    hash[31] = 7;
    expect(formatSafetyNumber(hash)).toBe(
      '00007 00000 00000 00000 00000 00000 00000 00000 00000 00000 00000 00000',
    );
    hash[31] = 0;
    hash[30] = 1; // 256
    expect(formatSafetyNumber(hash).split(' ')[0]).toBe('00256');
  });
});

describe('deviceFingerprint', () => {
  it('matches a vector computed independently', async () => {
    const fp = await deviceFingerprint('user-a', 'dev-1', key(1, 2, 3));
    expect(fingerprintToHex(fp)).toBe('15e7a7d2eeec0380e4ac775f66ae65ced4d8a3c066ec8e985db6cae58643a5fc');
    expect(formatSafetyNumber(fp)).toBe('19900 69242 54972 84346 07474 43231 96192 55608 12313 90783 91867 87764');
  });

  it('changes with the user id, device id or key', async () => {
    const base = fingerprintToHex(await deviceFingerprint('u', 'd', key(1)));
    expect(fingerprintToHex(await deviceFingerprint('v', 'd', key(1)))).not.toBe(base);
    expect(fingerprintToHex(await deviceFingerprint('u', 'e', key(1)))).not.toBe(base);
    expect(fingerprintToHex(await deviceFingerprint('u', 'd', key(2)))).not.toBe(base);
  });

  it('does not confuse field boundaries', async () => {
    const a = await deviceFingerprint('ab', 'c', key(1));
    const b = await deviceFingerprint('a', 'bc', key(1));
    expect(fingerprintToHex(a)).not.toBe(fingerprintToHex(b));
  });
});

describe('fingerprintFromLeaves', () => {
  const leaves = [leaf('a', 'a1', key(1)), leaf('b', 'b1', key(5)), leaf('a', 'a2', key(2))];

  it('matches a vector computed independently', async () => {
    const a = await fingerprintFromLeaves('a', leaves);
    expect(fingerprintToHex(a!)).toBe('fe502057421270d2106c8701848ae71ad6caa933069d53a59de451887dfd628e');
  });

  it('uses only that user leaves, in any leaf order', async () => {
    const fromLeaves = await fingerprintFromLeaves('a', leaves);
    const reversed = await fingerprintFromLeaves('a', [...leaves].reverse());
    expect(fingerprintToHex(reversed!)).toBe(fingerprintToHex(fromLeaves!));
  });

  it('changes when a device is added or its key changes', async () => {
    const base = fingerprintToHex((await fingerprintFromLeaves('a', leaves))!);
    const added = await fingerprintFromLeaves('a', [...leaves, leaf('a', 'a3', key(9))]);
    const rekeyed = await fingerprintFromLeaves('a', [leaf('a', 'a1', key(7)), leaf('a', 'a2', key(2))]);
    expect(fingerprintToHex(added!)).not.toBe(base);
    expect(fingerprintToHex(rekeyed!)).not.toBe(base);
  });

  it('is undefined for a user with no leaf', async () => {
    await expect(fingerprintFromLeaves('nobody', leaves)).resolves.toBeUndefined();
  });
});

describe('pairFingerprint', () => {
  const both = [leaf('a', 'a1', key(1)), leaf('a', 'a2', key(2)), leaf('b', 'b1', key(5))];

  it('is symmetric so both sides see the same digits', async () => {
    const a = (await fingerprintFromLeaves('a', both))!;
    const b = (await fingerprintFromLeaves('b', both))!;
    expect(formatSafetyNumber(await pairFingerprint(a, b))).toBe(formatSafetyNumber(await pairFingerprint(b, a)));
  });

  it('differs per pair', async () => {
    const a = (await fingerprintFromLeaves('a', both))!;
    const b = (await fingerprintFromLeaves('b', both))!;
    const c = await userFingerprint([await deviceFingerprint('c', 'c1', key(3))]);
    expect(formatSafetyNumber(await pairFingerprint(a, b))).not.toBe(formatSafetyNumber(await pairFingerprint(a, c)));
  });

  it('matches a vector computed independently', async () => {
    const a = (await fingerprintFromLeaves('a', both))!;
    const b = (await fingerprintFromLeaves('b', both))!;
    expect(formatSafetyNumber(await pairFingerprint(a, b))).toBe(
      '00962 74092 93727 81508 53014 21924 83907 79776 98120 54729 77969 02703',
    );
  });
});

describe('compareBytes', () => {
  it('orders lexicographically, shorter first on a shared prefix', () => {
    expect(compareBytes(key(1), key(2))).toBeLessThan(0);
    expect(compareBytes(key(1), key(1, 0))).toBeLessThan(0);
    expect(compareBytes(key(1, 2), key(1, 2))).toBe(0);
  });
});
