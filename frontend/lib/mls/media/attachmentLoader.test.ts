import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptAttachment } from './attachmentCrypto';
import {
  clearAttachmentCache,
  isTrustedBlobUrl,
  loadAttachmentBlob,
  type AttachmentSource,
} from './attachmentLoader';
import { GCM_TAG_BYTES, MAX_THUMBNAIL_BYTES } from './limits';

const URL_OK = 'https://res.cloudinary.com/demo/raw/upload/v1/gachahub/chat-blob/u/x';
const PLAINTEXT = new TextEncoder().encode('hello attachment');

let counter = 0;
async function makeSource(overrides: Partial<AttachmentSource> = {}) {
  const encrypted = await encryptAttachment(PLAINTEXT);
  const source: AttachmentSource = {
    cacheKey: `m${counter++}:0:file`,
    url: URL_OK,
    ref: { blob: 'up', key: encrypted.key, iv: encrypted.iv, sha256: encrypted.sha256 },
    size: PLAINTEXT.length,
    mime: 'text/plain',
    ...overrides,
  };
  return { source, ciphertext: encrypted.ciphertext };
}

const respond = (body: Uint8Array, headers: Record<string, string> = {}) =>
  new Response(body as BodyInit, { headers });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearAttachmentCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('isTrustedBlobUrl', () => {
  it('accepts only https on exactly res.cloudinary.com without userinfo or port', () => {
    expect(isTrustedBlobUrl(URL_OK)).toBe(true);
    for (const bad of [
      'http://res.cloudinary.com/a',
      'https://evil.com/a',
      'https://res.cloudinary.com.evil.com/a',
      'https://res.cloudinary.com@evil.com/a',
      'https://user:pw@res.cloudinary.com/a',
      'https://res.cloudinary.com:8443/a',
      'not a url',
      '',
    ]) {
      expect(isTrustedBlobUrl(bad), bad).toBe(false);
    }
  });
});

describe('loadAttachmentBlob', () => {
  it('downloads without credentials or redirects, decrypts, and caches', async () => {
    const { source, ciphertext } = await makeSource();
    fetchMock.mockImplementation(async () => respond(ciphertext));

    const blob = await loadAttachmentBlob(source);
    await loadAttachmentBlob(source);

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PLAINTEXT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });

  it('refuses an untrusted url without fetching', async () => {
    const { source } = await makeSource({ url: 'https://evil.com/x' });

    await expect(loadAttachmentBlob(source)).rejects.toMatchObject({ code: 'malformed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a body whose size does not match the envelope', async () => {
    const { source, ciphertext } = await makeSource({ size: PLAINTEXT.length + 1 });
    fetchMock.mockImplementation(async () => respond(ciphertext));

    await expect(loadAttachmentBlob(source)).rejects.toMatchObject({ code: 'integrity' });
  });

  it('fails fast on a Content-Length above the cap', async () => {
    const { source, ciphertext } = await makeSource();
    const response = respond(ciphertext, { 'content-length': String(PLAINTEXT.length + 100) });
    const cancel = vi.spyOn(response.body!, 'cancel');
    fetchMock.mockResolvedValue(response);

    await expect(loadAttachmentBlob(source)).rejects.toMatchObject({ code: 'too-large' });
    expect(cancel).toHaveBeenCalled();
  });

  it('stops reading a stream that runs past the cap', async () => {
    const { source } = await makeSource();
    const limit = PLAINTEXT.length + GCM_TAG_BYTES;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(limit));
      },
    });
    fetchMock.mockResolvedValue(new Response(stream));

    await expect(loadAttachmentBlob(source)).rejects.toMatchObject({ code: 'too-large' });
    expect(pulls).toBeLessThan(5);
  });

  it('caps thumbnails by the thumbnail limit', async () => {
    const { source } = await makeSource({ size: undefined });
    const big = new Uint8Array(MAX_THUMBNAIL_BYTES + GCM_TAG_BYTES + 1);
    fetchMock.mockImplementation(async () => respond(big));

    await expect(loadAttachmentBlob(source)).rejects.toMatchObject({ code: 'too-large' });
  });

  it('surfaces a refused redirect as a failure', async () => {
    const { source } = await makeSource();
    fetchMock.mockRejectedValue(new TypeError('redirect mode is set to error'));

    await expect(loadAttachmentBlob(source)).rejects.toThrow(TypeError);
  });

  it('shares one request between concurrent callers', async () => {
    const { source, ciphertext } = await makeSource();
    fetchMock.mockImplementation(async () => respond(ciphertext));

    await Promise.all([loadAttachmentBlob(source), loadAttachmentBlob(source)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('abort and clear', () => {
  const hangingFetch = () =>
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

  it('aborts the download when its only caller leaves', async () => {
    const { source } = await makeSource();
    hangingFetch();
    const controller = new AbortController();

    const pending = loadAttachmentBlob(source, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it('keeps the download alive while another caller still waits', async () => {
    const { source, ciphertext } = await makeSource();
    let release!: () => void;
    fetchMock.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(respond(ciphertext)))),
    );
    const leaver = new AbortController();

    const leaving = loadAttachmentBlob(source, leaver.signal);
    const staying = loadAttachmentBlob(source);
    leaver.abort();
    await expect(leaving).rejects.toMatchObject({ name: 'AbortError' });
    release();

    await expect(staying).resolves.toBeInstanceOf(Blob);
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(false);
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const { source } = await makeSource();
    hangingFetch();
    const controller = new AbortController();
    controller.abort();

    await expect(loadAttachmentBlob(source, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('clearAttachmentCache drops plaintext and cancels pending downloads', async () => {
    const cached = await makeSource();
    fetchMock.mockImplementation(async () => respond(cached.ciphertext));
    await loadAttachmentBlob(cached.source);
    clearAttachmentCache();
    await loadAttachmentBlob(cached.source);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const pending = await makeSource();
    hangingFetch();
    const inFlight = loadAttachmentBlob(pending.source);
    clearAttachmentCache();

    await expect(inFlight).rejects.toMatchObject({ name: 'AbortError' });
  });
});
