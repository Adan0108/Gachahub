import { describe, expect, it } from 'vitest';
import { deriveBlobState, type SettledLoad } from './attachmentBlobState';
import type { AttachmentSource } from './attachmentLoader';

const source = (cacheKey: string, url = 'https://res.cloudinary.com/a'): AttachmentSource => ({
  cacheKey,
  url,
  ref: { blob: 'b', key: 'k', iv: 'i', sha256: 's' },
  mime: 'image/png',
});
const ready = (cacheKey: string, url = 'https://res.cloudinary.com/a'): SettledLoad => ({
  cacheKey,
  url,
  outcome: { url: 'blob:x' },
});

describe('deriveBlobState', () => {
  it('is idle when disabled or without a source', () => {
    expect(deriveBlobState(ready('a'), source('a'), false)).toEqual({ status: 'idle' });
    expect(deriveBlobState(ready('a'), null, true)).toEqual({ status: 'idle' });
  });

  it('is loading until something settles for this exact source', () => {
    expect(deriveBlobState(null, source('a'), true)).toEqual({ status: 'loading' });
    expect(deriveBlobState(ready('a'), source('b'), true)).toEqual({ status: 'loading' });
  });

  it('does not reuse a result from the same key with a different url', () => {
    const next = source('a', 'https://res.cloudinary.com/other');

    expect(deriveBlobState(ready('a'), next, true)).toEqual({ status: 'loading' });
  });

  it('reports ready and error outcomes', () => {
    expect(deriveBlobState(ready('a'), source('a'), true)).toEqual({
      status: 'ready',
      url: 'blob:x',
    });
    const failed: SettledLoad = {
      cacheKey: 'a',
      url: 'https://res.cloudinary.com/a',
      outcome: { message: 'nope' },
    };
    expect(deriveBlobState(failed, source('a'), true)).toEqual({
      status: 'error',
      message: 'nope',
    });
  });
});
