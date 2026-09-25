import { describe, expect, it } from 'vitest';
import { AttachmentError, decryptAttachment, encryptAttachment } from './attachmentCrypto';
import { bytesToBase64 } from '../storage/base64';

const sample = () => new TextEncoder().encode('hello attachment');

describe('attachment crypto', () => {
  it('round-trips bytes', async () => {
    const encrypted = await encryptAttachment(sample());
    const plaintext = await decryptAttachment(encrypted.ciphertext, encrypted);

    expect(new TextDecoder().decode(plaintext)).toBe('hello attachment');
  });

  it('round-trips an empty file', async () => {
    const encrypted = await encryptAttachment(new Uint8Array(0));

    expect((await decryptAttachment(encrypted.ciphertext, encrypted)).length).toBe(0);
  });

  it('uses a fresh key and iv every time and hides the plaintext', async () => {
    const a = await encryptAttachment(sample());
    const b = await encryptAttachment(sample());

    expect(a.key).not.toBe(b.key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.sha256).toBe(b.sha256);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(new TextDecoder().decode(a.ciphertext)).not.toContain('hello');
  });

  it('adds only the GCM tag to the size', async () => {
    const encrypted = await encryptAttachment(sample());

    expect(encrypted.ciphertext.length).toBe(sample().length + 16);
  });

  it('detects a flipped ciphertext byte', async () => {
    const encrypted = await encryptAttachment(sample());
    encrypted.ciphertext[0] = encrypted.ciphertext[0]! ^ 1;

    await expect(decryptAttachment(encrypted.ciphertext, encrypted)).rejects.toMatchObject({
      code: 'integrity',
    });
  });

  it('detects a truncated ciphertext', async () => {
    const encrypted = await encryptAttachment(sample());

    await expect(
      decryptAttachment(encrypted.ciphertext.slice(0, -1), encrypted),
    ).rejects.toBeInstanceOf(AttachmentError);
  });

  it('fails with the wrong key', async () => {
    const encrypted = await encryptAttachment(sample());
    const other = await encryptAttachment(sample());

    await expect(
      decryptAttachment(encrypted.ciphertext, { ...encrypted, key: other.key }),
    ).rejects.toMatchObject({ code: 'integrity' });
  });

  it('fails with the wrong iv', async () => {
    const encrypted = await encryptAttachment(sample());
    const other = await encryptAttachment(sample());

    await expect(
      decryptAttachment(encrypted.ciphertext, { ...encrypted, iv: other.iv }),
    ).rejects.toMatchObject({ code: 'integrity' });
  });

  it('rejects a checksum that does not match the plaintext', async () => {
    const encrypted = await encryptAttachment(sample());
    const wrongHash = bytesToBase64(new Uint8Array(32));

    await expect(
      decryptAttachment(encrypted.ciphertext, { ...encrypted, sha256: wrongHash }),
    ).rejects.toMatchObject({ code: 'integrity' });
  });

  it('rejects malformed key material', async () => {
    const encrypted = await encryptAttachment(sample());

    await expect(
      decryptAttachment(encrypted.ciphertext, { ...encrypted, key: 'AAAA' }),
    ).rejects.toMatchObject({ code: 'malformed' });
    await expect(
      decryptAttachment(encrypted.ciphertext, { ...encrypted, iv: '!!!' }),
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('enforces the size cap on both directions', async () => {
    await expect(encryptAttachment(new Uint8Array(11), 10)).rejects.toMatchObject({
      code: 'too-large',
    });

    const encrypted = await encryptAttachment(new Uint8Array(10), 10);
    await expect(
      decryptAttachment(new Uint8Array(10 + 16 + 1), encrypted, 10),
    ).rejects.toMatchObject({ code: 'too-large' });
    await expect(decryptAttachment(encrypted.ciphertext, encrypted, 10)).resolves.toHaveLength(10);
  });
});
