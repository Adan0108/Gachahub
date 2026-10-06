import { Logger } from '@nestjs/common';
import { LinkPreviewCache } from './link-preview.cache';
import type { LinkPreview } from './link-preview.types';
import type { RedisService } from '../redis/redis.service';

const preview: LinkPreview = {
  url: 'https://example.com/a?token=secret',
  domain: 'example.com',
  resolvedDomain: null,
  title: 'A page',
  description: null,
  siteName: null,
  image: null,
};

describe('LinkPreviewCache', () => {
  const redis = {
    get: jest.fn<Promise<string | null>, [string]>(),
    set: jest.fn(),
  };
  const cache = new LinkPreviewCache(redis as unknown as RedisService);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  it('keeps a preview for six hours', async () => {
    await cache.setPreview(preview.url, preview);

    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ ok: true, preview }),
      6 * 60 * 60,
    );
  });

  it('keeps a failure for ten minutes', async () => {
    await cache.setFailure(preview.url);

    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ ok: false }),
      10 * 60,
    );
  });

  it('keys by a hash, so the link and anything secret in it never appear in Redis keys', async () => {
    await cache.setPreview(preview.url, preview);
    await cache.get(preview.url);

    const [setKey] = redis.set.mock.calls[0] as [string];
    const [getKey] = redis.get.mock.calls[0];
    expect(setKey).toMatch(/^link-preview:v1:[0-9a-f]{64}$/);
    expect(getKey).toBe(setKey);
    expect(setKey).not.toContain('secret');
    expect(setKey).not.toContain('example');
  });

  it('gives different links different keys', async () => {
    await cache.get('https://example.com/a');
    await cache.get('https://example.com/b');

    expect(redis.get.mock.calls[0][0]).not.toBe(redis.get.mock.calls[1][0]);
  });

  it('reads back a stored preview and a stored failure', async () => {
    redis.get.mockResolvedValueOnce(JSON.stringify({ ok: true, preview }));
    redis.get.mockResolvedValueOnce(JSON.stringify({ ok: false }));

    await expect(cache.get('a')).resolves.toEqual({ ok: true, preview });
    await expect(cache.get('b')).resolves.toEqual({ ok: false });
  });

  it('has nothing for a link it has not seen', async () => {
    redis.get.mockResolvedValue(null);

    await expect(cache.get('a')).resolves.toBeNull();
  });

  it.each([
    ['not json'],
    ['null'],
    ['42'],
    ['"text"'],
    ['{"ok":"yes"}'],
    ['{}'],
  ])('treats the unreadable entry %s as a miss', async (raw) => {
    redis.get.mockResolvedValue(raw);

    await expect(cache.get('a')).resolves.toBeNull();
  });

  it('carries on without a cache when Redis fails to read', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));

    await expect(cache.get('a')).resolves.toBeNull();
  });

  it('carries on without a cache when Redis fails to write', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));

    await expect(cache.setPreview('a', preview)).resolves.toBeUndefined();
    await expect(cache.setFailure('a')).resolves.toBeUndefined();
  });
});
