import { describe, expect, it } from 'vitest';
import { publishableGroupInfo } from './groupInfoPublishing';

describe('publishableGroupInfo', () => {
  it('encodes bytes that fit under the cap', () => {
    expect(publishableGroupInfo(new Uint8Array([1, 2, 3]))).toBe('AQID');
  });

  it('omits (returns undefined for) anything over the 60,000-char cap the server enforces', () => {
    // base64 is ~4/3 the input size, so this comfortably exceeds 60,000 encoded characters
    const oversized = new Uint8Array(60_000);

    const result = publishableGroupInfo(oversized);

    expect(result).toBeUndefined();
  });

  it('accepts exactly at the boundary', () => {
    // 45,000 raw bytes encode to exactly 60,000 base64 characters (4/3 ratio, no padding)
    const atBoundary = new Uint8Array(45_000);

    const result = publishableGroupInfo(atBoundary);

    expect(result).toBeDefined();
    expect(result?.length).toBe(60_000);
  });
});
