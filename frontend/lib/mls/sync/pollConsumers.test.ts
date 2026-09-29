import { describe, expect, it } from 'vitest';
import { PollConsumers } from './pollConsumers';

describe('PollConsumers', () => {
  it('starts a loop for the first consumer only, and stops it when the last one leaves', () => {
    const consumers = new PollConsumers<string>();

    expect(consumers.acquire('a')).toBe(true);
    expect(consumers.acquire('a')).toBe(false);
    expect(consumers.release('a')).toBe(false);
    expect(consumers.release('a')).toBe(true);
  });

  it('restarts the count for a new owner, so the old owner cleanups cannot keep it alive', () => {
    const consumers = new PollConsumers<string>();
    consumers.acquire('old');
    consumers.acquire('old');

    expect(consumers.acquire('new')).toBe(true);
    expect(consumers.release('old')).toBe(false);
    expect(consumers.release('old')).toBe(false);
    expect(consumers.release('new')).toBe(true);
  });

  it('starts again after everyone left', () => {
    const consumers = new PollConsumers<string>();
    consumers.acquire('a');
    consumers.release('a');

    expect(consumers.acquire('a')).toBe(true);
  });

  it('ignores a release nobody acquired', () => {
    expect(new PollConsumers<string>().release('a')).toBe(false);
  });
});
