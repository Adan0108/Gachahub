import { describe, expect, it } from 'vitest';
import {
  formatRecoveryKey,
  generateBackupKey,
  parseRecoveryKey,
  RecoveryKeyError,
} from './backupKey';

const problemOf = async (text: string) =>
  parseRecoveryKey(text).then(
    () => undefined,
    (error: unknown) => (error as RecoveryKeyError).problem,
  );

describe('recovery key', () => {
  it('generates 256 random bits', () => {
    const a = generateBackupKey();
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(generateBackupKey());
  });

  it('formats as 8 dash-separated groups of 8 base32 characters', async () => {
    const text = await formatRecoveryKey(generateBackupKey());
    expect(text).toMatch(/^([A-Z2-7]{8}-){7}[A-Z2-7]{8}$/);
  });

  it('round-trips, ignoring case, spaces and dashes', async () => {
    const key = generateBackupKey();
    const text = await formatRecoveryKey(key);

    await expect(parseRecoveryKey(text)).resolves.toEqual(key);
    await expect(parseRecoveryKey(text.toLowerCase().replaceAll('-', ' '))).resolves.toEqual(key);
    await expect(parseRecoveryKey(`  ${text.replaceAll('-', '')}\n`)).resolves.toEqual(key);
  });

  it('round-trips keys with leading zero bytes and all-ones', async () => {
    for (const key of [new Uint8Array(32), new Uint8Array(32).fill(255)]) {
      await expect(parseRecoveryKey(await formatRecoveryKey(key))).resolves.toEqual(key);
    }
  });

  it('catches a mistyped character in the key part through the checksum', async () => {
    const text = await formatRecoveryKey(generateBackupKey());
    const first = text[0] === 'A' ? 'B' : 'A';

    await expect(problemOf(first + text.slice(1))).resolves.toBe('checksum');
  });

  it('catches a mistyped character in the checksum part', async () => {
    const text = await formatRecoveryKey(generateBackupKey());
    const last = text.length - 1;
    const swapped = text.slice(0, last) + (text[last] === 'A' ? 'B' : 'A');

    await expect(problemOf(swapped)).resolves.toBe('checksum');
  });

  it('reports a wrong length and forbidden characters', async () => {
    const text = await formatRecoveryKey(generateBackupKey());

    await expect(problemOf(text.slice(0, -1))).resolves.toBe('length');
    await expect(problemOf(`${text}A`)).resolves.toBe('length');
    await expect(problemOf(`9${text.slice(1)}`)).resolves.toBe('characters');
    await expect(problemOf('')).resolves.toBe('length');
  });
});

describe('recovery key look-alikes', () => {
  it('reads 0, 1 and 8 as O, I and B', async () => {
    let key: Uint8Array;
    let text: string;
    do {
      key = generateBackupKey();
      text = await formatRecoveryKey(key);
    } while (!/[OIB]/.test(text));
    const typed = text.replace(/O/g, '0').replace(/I/g, '1').replace(/B/g, '8');

    expect(typed).not.toBe(text);
    await expect(parseRecoveryKey(typed)).resolves.toEqual(key);
  });

  it('still rejects 9, which has no look-alike', async () => {
    const text = await formatRecoveryKey(generateBackupKey());

    await expect(problemOf(`9${text.slice(1)}`)).resolves.toBe('characters');
  });
});
