import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptAttachment } from './attachmentCrypto';
import { buildAttachmentEnvelope, isAttachmentEnvelope } from './attachmentEnvelope';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_FILES_PER_MESSAGE,
  MAX_TOTAL_ATTACHMENT_BYTES,
  THUMBNAIL_MAX_EDGE_GROUPED,
  THUMBNAIL_MAX_EDGE_SOLO,
} from './limits';
import {
  assertSendable,
  PREPARE_CONCURRENCY,
  prepareAttachments,
  type OpaqueBlob,
  type PreparedFiles,
} from './prepareAttachments';
import { generateThumbnail } from './thumbnail';

vi.mock('./thumbnail', () => ({ generateThumbnail: vi.fn(async () => null) }));

beforeEach(() => vi.clearAllMocks());

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

  it('keeps the entries in the order of the files, each with its own upload', async () => {
    const upload = fakeUpload();
    const files = [new File(['a'], 'a.bin'), new File(['b'], 'b.bin')];

    const entries = await prepareAttachments(files, upload);

    expect(entries.map((entry) => entry.name)).toEqual(['a.bin', 'b.bin']);
    // Which upload finishes first is up to the network; each file just has to keep its own
    expect(new Set(entries.map((entry) => entry.blob)).size).toBe(2);
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

  describe('several files at once', () => {
    /** An uploader that records how many uploads are under way, and finishes each after a tick. */
    function trackedUpload() {
      let inFlight = 0;
      let peak = 0;
      const upload = vi.fn(async (blobs: OpaqueBlob[]) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return blobs.map((_, index) => `id-${upload.mock.calls.length}-${index}`);
      });
      return { upload, peak: () => peak };
    }
    const names = (count: number) =>
      Array.from({ length: count }, (_, index) => new File([`f${index}`], `f${index}.bin`));

    it('overlaps the uploads, but never more than the limit', async () => {
      const { upload, peak } = trackedUpload();

      await prepareAttachments(names(8), upload);

      expect(peak()).toBeGreaterThan(1);
      expect(peak()).toBeLessThanOrEqual(PREPARE_CONCURRENCY);
      expect(upload).toHaveBeenCalledTimes(8);
    });

    it('still returns the entries in the order of the files', async () => {
      const { upload } = trackedUpload();
      const files = names(6);

      const entries = await prepareAttachments(files, upload);

      expect(entries.map((entry) => entry.name)).toEqual(files.map((file) => file.name));
    });

    it('stops starting new files after a failure, keeps the ones that finished, and throws the first error', async () => {
      const done: PreparedFiles = new Map();
      let calls = 0;
      const upload = vi.fn(async (blobs: OpaqueBlob[]) => {
        calls += 1;
        if (calls === 2) throw new Error('network');
        await new Promise((resolve) => setTimeout(resolve, 5));
        return blobs.map(() => `ok-${calls}`);
      });

      await expect(prepareAttachments(names(9), upload, undefined, done)).rejects.toThrow('network');

      // The others already under way were let finish and kept; nothing new was started after the failure
      expect(done.size).toBeLessThan(9);
      expect(done.size).toBeGreaterThan(0);
      expect(upload.mock.calls.length).toBeLessThan(9);
    });

    it('does not redo files that already finished when it is tried again', async () => {
      const done: PreparedFiles = new Map();
      const files = names(4);
      let failOnce = true;
      const upload = vi.fn(async (blobs: OpaqueBlob[]) => {
        if (failOnce && upload.mock.calls.length === 3) {
          failOnce = false;
          throw new Error('network');
        }
        return blobs.map(() => `ok-${upload.mock.calls.length}`);
      });

      await expect(prepareAttachments(files, upload, undefined, done)).rejects.toThrow('network');
      const finished = done.size;
      upload.mockClear();
      await prepareAttachments(files, upload, undefined, done);

      expect(upload).toHaveBeenCalledTimes(4 - finished);
    });
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

describe('prepareAttachments thumbnail sizing', () => {
  it('asks for the solo (large) thumbnail edge when exactly one visual file is sent', async () => {
    const upload = fakeUpload();
    const image = new File(['a'], 'a.png', { type: 'image/png' });

    await prepareAttachments([image], upload);

    expect(generateThumbnail).toHaveBeenCalledWith(image, THUMBNAIL_MAX_EDGE_SOLO);
  });

  it('asks for the grouped (small) thumbnail edge when multiple visual files share a message', async () => {
    const upload = fakeUpload();
    const images = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];

    await prepareAttachments(images, upload);

    expect(generateThumbnail).toHaveBeenCalledWith(images[0], THUMBNAIL_MAX_EDGE_GROUPED);
    expect(generateThumbnail).toHaveBeenCalledWith(images[1], THUMBNAIL_MAX_EDGE_GROUPED);
  });

  it('counts only visual files toward solo/grouped - a lone image plus a PDF still counts as solo', async () => {
    const upload = fakeUpload();
    const image = new File(['a'], 'a.png', { type: 'image/png' });
    const pdf = new File(['b'], 'b.pdf', { type: 'application/pdf' });

    await prepareAttachments([image, pdf], upload);

    expect(generateThumbnail).toHaveBeenCalledWith(image, THUMBNAIL_MAX_EDGE_SOLO);
  });
});
