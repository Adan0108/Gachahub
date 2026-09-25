import { describe, expect, it } from 'vitest';
import { SESSION_LINK_LABEL, TsMlsDeviceIdentityStore } from './tsMlsAdapter';

describe('SESSION_LINK_LABEL', () => {
  it('is pinned to the exact string the backend must also use', () => {
    // Any change here without the matching change in backend/src/chat-devices/session-link-proof.ts
    // makes every session link fail signature verification.
    expect(SESSION_LINK_LABEL).toBe('gachahub/session-link/v1\n');
  });
});

describe('TsMlsDeviceIdentityStore.signSessionLinkChallenge', () => {
  it('refuses a challenge that is not the expected two-part token shape - the device key must never sign arbitrary bytes', async () => {
    const store = new TsMlsDeviceIdentityStore();
    await store.provision('user-1');

    await expect(store.signSessionLinkChallenge('not-a-challenge')).rejects.toThrow(
      'Unexpected challenge format',
    );
    await expect(store.signSessionLinkChallenge('')).rejects.toThrow();
  });

  it('produces a verifiable signature over the label-prefixed challenge, for a well-shaped one', async () => {
    const store = new TsMlsDeviceIdentityStore();
    const credential = await store.provision('user-1');

    const signature = await store.signSessionLinkChallenge('aGVhZA.dGFpbA');

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBeGreaterThan(0);
    expect(credential.userId).toBe('user-1');
  });
});
