import { describe, expect, it } from 'vitest';
import { BlobCache } from './blobCache';

const blob = (size: number) => new Blob([new Uint8Array(size)]);

describe('BlobCache', () => {
  it('returns what was stored', () => {
    const cache = new BlobCache(100);
    const value = blob(10);
    cache.set('a', value);

    expect(cache.get('a')).toBe(value);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the least recently used entries past the byte budget', () => {
    const cache = new BlobCache(25);
    cache.set('a', blob(10));
    cache.set('b', blob(10));
    cache.get('a');
    cache.set('c', blob(10));

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('does not cache a single blob bigger than the budget', () => {
    const cache = new BlobCache(5);
    cache.set('big', blob(10));

    expect(cache.get('big')).toBeUndefined();
  });

  it('clear drops everything and resets the byte count', () => {
    const cache = new BlobCache(15);
    cache.set('a', blob(10));
    cache.clear();
    cache.set('b', blob(10));

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
  });

  it('replacing a key does not double count its bytes', () => {
    const cache = new BlobCache(15);
    cache.set('a', blob(10));
    cache.set('a', blob(10));
    cache.set('b', blob(5));

    expect(cache.get('a')).toBeDefined();
    expect(cache.get('b')).toBeDefined();
  });
});
