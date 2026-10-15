import { describe, expect, it } from 'vitest';
import { claimDecrypt, whenDecryptReleased } from './decryptClaims';

describe('decryptClaims', () => {
  it('lets one run take a message and turns everyone else away', () => {
    const release = claimDecrypt('claim-a');

    expect(release).toBeTypeOf('function');
    expect(claimDecrypt('claim-a')).toBeNull();

    release?.();
  });

  it('hands the message to the next run once it is released', () => {
    claimDecrypt('claim-b')?.();

    const again = claimDecrypt('claim-b');

    expect(again).toBeTypeOf('function');
    again?.();
  });

  it('keeps messages apart', () => {
    const first = claimDecrypt('claim-c1');
    const second = claimDecrypt('claim-c2');

    expect(second).toBeTypeOf('function');

    first?.();
    second?.();
  });

  it('tells a waiter when the holder lets go', async () => {
    const release = claimDecrypt('claim-d')!;
    let released = false;
    void whenDecryptReleased('claim-d')?.then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);

    release();
    await Promise.resolve();
    expect(released).toBe(true);
  });

  it('has nothing to wait on for a message nobody holds', () => {
    expect(whenDecryptReleased('claim-e')).toBeUndefined();
  });

  it('ignores a second release, which must not free a newer claim', () => {
    const first = claimDecrypt('claim-f')!;
    first();
    const second = claimDecrypt('claim-f')!;

    first();

    expect(claimDecrypt('claim-f')).toBeNull();
    second();
  });
});
