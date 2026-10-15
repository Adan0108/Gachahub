import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptAttachment } from './attachmentCrypto';
import { MAX_THUMBNAIL_BYTES, THUMBNAIL_MAX_EDGE_GROUPED } from './limits';
import { prepareLinkPreview, type LinkPreviewData } from './prepareLinkPreview';
import type { OpaqueBlob } from './prepareAttachments';
import { generateThumbnail } from './thumbnail';
import { bytesToBase64 } from '../storage/base64';

vi.mock('./thumbnail', () => ({ generateThumbnail: vi.fn() }));

const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const THUMB_BYTES = new TextEncoder().encode('shrunk picture bytes');

const data = (extra: Partial<LinkPreviewData> = {}): LinkPreviewData => ({
  url: 'https://example.com/post',
  domain: 'example.com',
  resolvedDomain: null,
  title: 'A post',
  description: 'About a thing',
  siteName: 'Example',
  image: { mime: 'image/png', data: bytesToBase64(PICTURE) },
  ...extra,
});

const fakeUpload = () => vi.fn(async (blobs: OpaqueBlob[]) => blobs.map((_, index) => `upload-${index + 1}`));

describe('prepareLinkPreview', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(generateThumbnail).mockResolvedValue({ bytes: THUMB_BYTES, width: 320, height: 180 });
  });

  it('builds the card, with the picture shrunk, encrypted and uploaded', async () => {
    const upload = fakeUpload();

    const card = await prepareLinkPreview(data(), upload);

    expect(card).toMatchObject({
      url: 'https://example.com/post',
      title: 'A post',
      description: 'About a thing',
      siteName: 'Example',
      thumb: { blob: 'upload-1', width: 320, height: 180 },
    });
    expect(upload).toHaveBeenCalledTimes(1);
    const [blobs] = upload.mock.calls[0]!;
    expect(blobs).toHaveLength(1);
    // not a THUMB: the server only takes those next to the attachment they belong to
    expect(blobs[0]!.kind).toBe('BLOB');
  });

  it('shrinks the picture to a card-sized thumbnail', async () => {
    await prepareLinkPreview(data(), fakeUpload());

    const [file, maxEdge] = vi.mocked(generateThumbnail).mock.calls[0]!;
    expect(maxEdge).toBe(THUMBNAIL_MAX_EDGE_GROUPED);
    expect((file as File).type).toBe('image/png');
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(PICTURE);
  });

  it('uploads only ciphertext, which the card lets the recipient decrypt', async () => {
    const upload = fakeUpload();

    const card = await prepareLinkPreview(data(), upload);

    const [blobs] = upload.mock.calls[0]!;
    expect(new TextDecoder().decode(blobs[0]!.bytes)).not.toContain('shrunk');
    const decrypted = await decryptAttachment(blobs[0]!.bytes, card!.thumb!);
    expect(decrypted).toEqual(THUMB_BYTES);
  });

  it('keeps the encrypted picture under the thumbnail size cap', async () => {
    const upload = fakeUpload();

    await prepareLinkPreview(data(), upload);

    const [blobs] = upload.mock.calls[0]!;
    expect(blobs[0]!.bytes.length).toBeLessThanOrEqual(MAX_THUMBNAIL_BYTES + 16);
  });

  it('is a text-only card when the page has no picture, and uploads nothing', async () => {
    const upload = fakeUpload();

    const card = await prepareLinkPreview(data({ image: null }), upload);

    expect(card).toEqual({
      url: 'https://example.com/post',
      title: 'A post',
      description: 'About a thing',
      siteName: 'Example',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('leaves out description and site name when there are none', async () => {
    const card = await prepareLinkPreview(data({ description: null, siteName: null, image: null }), fakeUpload());

    expect(card).toEqual({ url: 'https://example.com/post', title: 'A post' });
  });

  it('is a picture-only card when the page has no title', async () => {
    const card = await prepareLinkPreview(data({ title: null, description: null, siteName: null }), fakeUpload());

    expect(card).toMatchObject({ url: 'https://example.com/post', thumb: { blob: 'upload-1' } });
    expect(card).not.toHaveProperty('title');
  });

  describe('when the picture cannot be prepared', () => {
    it.each([
      ['the picture cannot be shrunk', () => vi.mocked(generateThumbnail).mockResolvedValue(null)],
      ['shrinking it throws', () => vi.mocked(generateThumbnail).mockRejectedValue(new Error('bad image'))],
    ])('still gives the text card when %s', async (_name, arrange) => {
      arrange();
      const upload = fakeUpload();

      const card = await prepareLinkPreview(data(), upload);

      expect(card).toEqual({
        url: 'https://example.com/post',
        title: 'A post',
        description: 'About a thing',
        siteName: 'Example',
      });
      expect(upload).not.toHaveBeenCalled();
    });

    it('still gives the text card when the upload fails', async () => {
      const upload = vi.fn().mockRejectedValue(new Error('offline'));

      const card = await prepareLinkPreview(data(), upload);

      expect(card).toMatchObject({ title: 'A post' });
      expect(card).not.toHaveProperty('thumb');
    });

    it('still gives the text card when the upload returns nothing', async () => {
      const upload = vi.fn().mockResolvedValue([]);

      const card = await prepareLinkPreview(data(), upload);

      expect(card).not.toHaveProperty('thumb');
      expect(card).toMatchObject({ title: 'A post' });
    });

    it('gives no card at all when there is neither a title nor a picture to show', async () => {
      vi.mocked(generateThumbnail).mockResolvedValue(null);

      expect(await prepareLinkPreview(data({ title: null }), fakeUpload())).toBeUndefined();
    });

    it('gives no card for a title that is only invisible characters', async () => {
      vi.mocked(generateThumbnail).mockResolvedValue(null);

      expect(await prepareLinkPreview(data({ title: `${String.fromCodePoint(0x200b)} ` }), fakeUpload())).toBeUndefined();
    });
  });

  it('tidies the text it puts in the card', async () => {
    const card = await prepareLinkPreview(
      data({ title: `Free${String.fromCodePoint(0x202e)}  gift`, image: null }),
      fakeUpload(),
    );

    expect(card!.title).toBe('Free gift');
  });
});
