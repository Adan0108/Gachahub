import { describe, expect, it } from 'vitest';
import {
  computeBackupProof,
  decryptBlob,
  deriveReplaceSecret,
  encryptBlob,
  importBackupKey,
  makeKeyCheck,
  verifyKeyCheck,
  type BackupPayload,
} from './backupCrypto';

const binding = { userId: 'u1', conversationId: 'c1', messageId: 'm1' };
const payload: BackupPayload = {
  senderDeviceId: 'd1',
  epoch: 4,
  envelope: { v: 1, type: 'text', body: 'hello' },
};

const newKey = () => importBackupKey(crypto.getRandomValues(new Uint8Array(32)));

describe('backup blobs', () => {
  it('round-trips a payload, including binary values', async () => {
    const key = await newKey();
    const withBytes: BackupPayload = {
      ...payload,
      envelope: { v: 1, type: 'text', body: { key: new Uint8Array([1, 2, 3]) } },
    };

    const blob = await encryptBlob(key, binding, withBytes);

    await expect(decryptBlob(key, binding, blob)).resolves.toEqual(withBytes);
  });

  it('uses a fresh nonce every time', async () => {
    const key = await newKey();
    const a = await encryptBlob(key, binding, payload);
    const b = await encryptBlob(key, binding, payload);

    expect(a).not.toEqual(b);
  });

  it('does not contain the plaintext', async () => {
    const blob = await encryptBlob(await newKey(), binding, payload);

    expect(new TextDecoder().decode(blob)).not.toContain('hello');
  });

  it('fails under the wrong key', async () => {
    const blob = await encryptBlob(await newKey(), binding, payload);

    await expect(decryptBlob(await newKey(), binding, blob)).rejects.toBeDefined();
  });

  it.each([
    ['message', { ...binding, messageId: 'm2' }],
    ['conversation', { ...binding, conversationId: 'c2' }],
    ['user', { ...binding, userId: 'u2' }],
  ])('fails when the blob is moved to another %s', async (_name, other) => {
    const key = await newKey();
    const blob = await encryptBlob(key, binding, payload);

    await expect(decryptBlob(key, other, blob)).rejects.toBeDefined();
  });

  it('does not let ids shift between fields', async () => {
    const key = await newKey();
    const blob = await encryptBlob(
      key,
      { userId: 'u', conversationId: '1c', messageId: 'm' },
      payload,
    );

    await expect(
      decryptBlob(key, { userId: 'u1', conversationId: 'c', messageId: 'm' }, blob),
    ).rejects.toBeDefined();
  });

  it('fails when a byte is flipped', async () => {
    const key = await newKey();
    const blob = await encryptBlob(key, binding, payload);
    blob.set([blob[blob.length - 1]! ^ 1], blob.length - 1);

    await expect(decryptBlob(key, binding, blob)).rejects.toBeDefined();
  });

  it('rejects an unknown version and a truncated blob', async () => {
    const key = await newKey();
    const blob = await encryptBlob(key, binding, payload);

    await expect(
      decryptBlob(key, binding, Uint8Array.from([9, ...blob.slice(1)])),
    ).rejects.toThrow();
    await expect(decryptBlob(key, binding, blob.slice(0, 5))).rejects.toThrow();
  });
});

describe('key check', () => {
  it('verifies under the same key and user', async () => {
    const key = await newKey();

    await expect(verifyKeyCheck(key, 'u1', await makeKeyCheck(key, 'u1'))).resolves.toBe(true);
  });

  it('rejects a wrong key, another user, and garbage', async () => {
    const key = await newKey();
    const check = await makeKeyCheck(key, 'u1');

    await expect(verifyKeyCheck(await newKey(), 'u1', check)).resolves.toBe(false);
    await expect(verifyKeyCheck(key, 'u2', check)).resolves.toBe(false);
    await expect(verifyKeyCheck(key, 'u1', new Uint8Array(40))).resolves.toBe(false);
  });

  it('is a size the server accepts (16 to 256 bytes)', async () => {
    const check = await makeKeyCheck(await newKey(), 'u1');

    expect(check.length).toBeGreaterThanOrEqual(16);
    expect(check.length).toBeLessThanOrEqual(256);
  });
});

describe('replace proof', () => {
  const parts = {
    userId: 'u1',
    nonce: 'bm9uY2U=',
    keyCheck: 'a2V5Y2hlY2s=',
    replaceSecret: 'c2VjcmV0',
  };

  it('matches the backend test vector', async () => {
    const proof = await computeBackupProof(new Uint8Array(32).fill(9), 'replace', parts);

    expect(proof).toBe('vFpeZotdsgzGcuhopWvFH9uMhoYEutxFH5/9p7XGJmY=');
  });

  it('matches the backend vectors for delete and cancel-delete', async () => {
    const secret = new Uint8Array(32).fill(9);
    const bare = { userId: 'u1', nonce: 'bm9uY2U=' };

    expect(await computeBackupProof(secret, 'delete', bare)).toBe(
      'JLrcpB1L5pYqeNL2S6etYcxV84rQhATcGk4Pbwd4xGE=',
    );
    expect(await computeBackupProof(secret, 'cancel-delete', bare)).toBe(
      'sIUvZusisKH4Y5eMLmdJs6VasV+Y6/Aix1G9UA6VgyY=',
    );
  });

  it('derives a stable secret that depends on the key', async () => {
    const a = await deriveReplaceSecret(new Uint8Array(32).fill(1));

    expect(a).toHaveLength(32);
    expect(await deriveReplaceSecret(new Uint8Array(32).fill(1))).toEqual(a);
    expect(await deriveReplaceSecret(new Uint8Array(32).fill(2))).not.toEqual(a);
  });
});
