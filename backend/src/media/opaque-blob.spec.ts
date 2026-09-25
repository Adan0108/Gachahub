import {
  MAX_OPAQUE_BLOBS_PER_MESSAGE,
  OPAQUE_MAX_BYTES,
  cloudinaryResourceTypeFor,
  opaqueFolder,
  opaqueKindOf,
  rawDeliveryUrl,
} from './opaque-blob';

describe('opaque-blob helpers', () => {
  it('round-trips the kind through the folder', () => {
    const blob = { publicId: `${opaqueFolder('BLOB', 'u1')}/abc` };
    const thumb = { publicId: `${opaqueFolder('THUMB', 'u1')}/abc` };

    expect(opaqueKindOf(blob)).toBe('BLOB');
    expect(opaqueKindOf(thumb)).toBe('THUMB');
  });

  it('does not treat regular chat media as opaque', () => {
    expect(opaqueKindOf({ publicId: 'gachahub/chat/u1/abc' })).toBeNull();
    expect(opaqueKindOf({ publicId: 'gachahub/chat-blobs/u1/abc' })).toBeNull();
  });

  it('prefers the stored opaqueKind over the folder', () => {
    expect(opaqueKindOf({ publicId: 'x/y', opaqueKind: 'THUMB' })).toBe(
      'THUMB',
    );
  });

  it('maps opaque blobs to raw and others by resource type', () => {
    expect(
      cloudinaryResourceTypeFor({
        publicId: 'gachahub/chat-blob/u1/a',
        resourceType: 'IMAGE',
      }),
    ).toBe('raw');
    expect(
      cloudinaryResourceTypeFor({
        publicId: 'x/y',
        resourceType: 'IMAGE',
        opaqueKind: 'BLOB',
      }),
    ).toBe('raw');
    expect(
      cloudinaryResourceTypeFor({ publicId: 'x/y', resourceType: 'VIDEO' }),
    ).toBe('video');
    expect(
      cloudinaryResourceTypeFor({ publicId: 'x/y', resourceType: 'IMAGE' }),
    ).toBe('image');
  });

  // Contract: frontend/lib/mls/media/limits.test.ts pins the same literals.
  it('keeps the caps the frontend limits mirror', () => {
    expect(OPAQUE_MAX_BYTES.BLOB).toBe(26_214_400);
    expect(OPAQUE_MAX_BYTES.THUMB).toBe(524_288);
    expect(MAX_OPAQUE_BLOBS_PER_MESSAGE).toBe(10);
  });

  it('builds the raw delivery url', () => {
    expect(
      rawDeliveryUrl({ cloudName: 'demo', version: 7, publicId: 'a/b' }),
    ).toBe('https://res.cloudinary.com/demo/raw/upload/v7/a/b');
  });
});
