import { describe, expect, it } from 'vitest';
import { fitWithin, generateThumbnail } from './thumbnail';

describe('fitWithin', () => {
  it('scales the longer edge down to the max, keeping aspect ratio', () => {
    expect(fitWithin(1000, 500, 320)).toEqual({ width: 320, height: 160 });
    expect(fitWithin(500, 1000, 320)).toEqual({ width: 160, height: 320 });
  });

  it('never upscales', () => {
    expect(fitWithin(100, 50, 320)).toEqual({ width: 100, height: 50 });
  });

  it('never collapses below one pixel', () => {
    expect(fitWithin(10000, 1, 320)).toEqual({ width: 320, height: 1 });
  });

  it('defaults to the shared thumbnail edge', () => {
    expect(fitWithin(3200, 3200)).toEqual({ width: 320, height: 320 });
  });
});

describe('generateThumbnail', () => {
  it('returns null outside a browser instead of throwing', async () => {
    const file = new File([new Uint8Array(4)], 'a.png', { type: 'image/png' });

    await expect(generateThumbnail(file)).resolves.toBeNull();
  });

  it('skips svg and non-media files', async () => {
    const svg = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
    const doc = new File(['x'], 'a.txt', { type: 'text/plain' });

    await expect(generateThumbnail(svg)).resolves.toBeNull();
    await expect(generateThumbnail(doc)).resolves.toBeNull();
  });
});
