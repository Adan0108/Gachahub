import { describe, expect, it, vi } from 'vitest';
import { decryptAttachment } from './attachmentCrypto';
import { buildAttachmentEnvelope, isAttachmentEnvelope } from './attachmentEnvelope';
import { MAX_ATTACHMENT_BYTES, MAX_FILES_PER_MESSAGE, MAX_TOTAL_ATTACHMENT_BYTES } from './limits';
import {
  assertSendable,
  prepareAttachments,
  type OpaqueBlob,
  type PreparedFiles,
} from './prepareAttachments';

const fakeUpload = () => {
  let next = 0;
  return vi.fn(async (blobs: OpaqueBlob[]) => blobs.map(() => `upload-${next++}`));
};

describe('assertSendable', () => {
  it('accepts a normal selection', () => {
    expect(() => assertSendable([{ name: 'a', size: 10 }])).not.toThrow();
  });

  it('rejects too many files, oversized files and oversized totals', () => {
    const many = Array.from({ length: MAX_FILES_PER_MESSAGE + 1 }, () => ({ name: 'a', size: 1 }));
    expect(() => assertSendable(many)).toThrow(/at most/);
    expect(() => assertSendable([{ name: 'big.bin', size: MAX_ATTACHMENT_BYTES + 1 }])).toThrow(
      /big.bin/,
    );
    const each = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES / 5) + 1;
    const heavy = Array.from({ length: 5 }, () => ({ name: 'a', size: each }));
    expect(each).toBeLessThanOrEqual(MAX_ATTACHMENT_BYTES);
    expect(() => assertSendable(heavy)).toThrow(/together/);
  });
});

describe('prepareAttachments', () => {
  it('uploads only ciphertext and returns a valid, decryptable envelope entry', async () => {
    const upload = fakeUpload();
    const stages: string[] = [];
    const secret = new TextEncoder().encode('top secret contents');
    const file = new File([secret], 'plan.txt', { type: 'text/plain' });

    const [entry] = await prepareAttachments([file], upload, (stage) => stages.push(stage));

    expect(stages).toEqual(['encrypting', 'uploading']);
    const [blobs] = upload.mock.calls[0]!;
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.kind).toBe('BLOB');
    expect(new TextDecoder().decode(blobs[0]!.bytes)).not.toContain('secret');
    expect(entry).toMatchObject({ name: 'plan.txt', mime: 'text/plain', size: secret.length });
    expect(entry!.blob).toBe('upload-0');
    expect(isAttachmentEnvelope(buildAttachmentEnvelope([entry!], ''))).toBe(true);

    const plaintext = await decryptAttachment(blobs[0]!.bytes, entry!);
    expect(plaintext).toEqual(secret);
  });

  it('keeps upload ids aligned with files in order', async () => {
    const upload = fakeUpload();
    const files = [new File(['a'], 'a.bin'), new File(['b'], 'b.bin')];

    const entries = await prepareAttachments(files, upload);

    expect(entries.map((entry) => [entry.name, entry.blob])).toEqual([
      ['a.bin', 'upload-0'],
      ['b.bin', 'upload-1'],
    ]);
    expect(entries[0]!.mime).toBe('application/octet-stream');
  });

  it('keeps finished files when a later upload fails, and skips them on retry', async () => {
    const done: PreparedFiles = new Map();
    const files = [new File(['a'], 'a.bin'), new File(['b'], 'b.bin')];
    const upload = fakeUpload();
    upload.mockImplementationOnce(async () => ['first']);
    upload.mockImplementationOnce(async () => {
      throw new Error('network');
    });

    await expect(prepareAttachments(files, upload, undefined, done)).rejects.toThrow('network');
    expect([...done.keys()]).toEqual([0]);

    const entries = await prepareAttachments(files, upload, undefined, done);

    expect(upload).toHaveBeenCalledTimes(3);
    expect(entries[0]!.blob).toBe('first');
  });

  it('refuses before encrypting when the selection is not sendable', async () => {
    const upload = fakeUpload();
    const many = Array.from({ length: MAX_FILES_PER_MESSAGE + 1 }, () => new File(['a'], 'a'));

    await expect(prepareAttachments(many, upload)).rejects.toMatchObject({ code: 'too-large' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('fails if the uploader returns the wrong number of ids', async () => {
    const upload = vi.fn(async () => []);

    await expect(prepareAttachments([new File(['a'], 'a')], upload)).rejects.toMatchObject({
      code: 'malformed',
    });
  });
});
