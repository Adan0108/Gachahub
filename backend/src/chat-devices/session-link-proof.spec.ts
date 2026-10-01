import { generateKeyPairSync, sign } from 'node:crypto';
import {
  isValidDeviceSignature,
  isValidLinkChallenge,
  issueLinkChallenge,
  SESSION_LINK_LABEL,
} from './session-link-proof';

describe('session link challenge', () => {
  const secret = 'server-secret';
  const params = { sessionId: 's1', deviceId: 'd1' };

  it('accepts the challenge for the login and device it was made for', () => {
    const challenge = issueLinkChallenge(secret, params, 1_000);

    expect(isValidLinkChallenge(secret, challenge, params, 2_000)).toBe(true);
  });

  it('refuses it for another login, another device, or after a minute', () => {
    const challenge = issueLinkChallenge(secret, params, 1_000);

    expect(
      isValidLinkChallenge(
        secret,
        challenge,
        { ...params, sessionId: 's2' },
        2_000,
      ),
    ).toBe(false);
    expect(
      isValidLinkChallenge(
        secret,
        challenge,
        { ...params, deviceId: 'd2' },
        2_000,
      ),
    ).toBe(false);
    expect(isValidLinkChallenge(secret, challenge, params, 62_000)).toBe(false);
  });

  it('refuses one made with a different secret, or tampered with', () => {
    const challenge = issueLinkChallenge(secret, params, 1_000);
    const [body, tag] = challenge.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...params, expiresAt: 9_999_999_999_999 }),
    ).toString('base64url');

    expect(isValidLinkChallenge('other', challenge, params, 2_000)).toBe(false);
    expect(
      isValidLinkChallenge(secret, `${forged}.${tag}`, params, 2_000),
    ).toBe(false);
    expect(isValidLinkChallenge(secret, body, params, 2_000)).toBe(false);
    expect(isValidLinkChallenge(secret, 'nonsense', params, 2_000)).toBe(false);
  });
});

describe('device signature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPublicKey = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32);
  const signed = (message: string) =>
    sign(null, Buffer.from(message), privateKey).toString('base64');

  it('accepts a signature made with the device key', () => {
    expect(isValidDeviceSignature(rawPublicKey, 'hello', signed('hello'))).toBe(
      true,
    );
  });

  it('refuses a signature over other text, from another key, or malformed', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    const otherSignature = sign(null, Buffer.from('hello'), other).toString(
      'base64',
    );

    expect(isValidDeviceSignature(rawPublicKey, 'hello', signed('bye'))).toBe(
      false,
    );
    expect(isValidDeviceSignature(rawPublicKey, 'hello', otherSignature)).toBe(
      false,
    );
    expect(isValidDeviceSignature(rawPublicKey, 'hello', 'not base64!')).toBe(
      false,
    );
    expect(
      isValidDeviceSignature(new Uint8Array(3), 'hello', signed('hello')),
    ).toBe(false);
  });
});

describe('SESSION_LINK_LABEL', () => {
  it('is pinned to the exact string the frontend adapter must also use', () => {
    // Any change here without the matching change in frontend/lib/mls/adapter/tsMlsAdapter.ts
    // makes every session link fail signature verification.
    expect(SESSION_LINK_LABEL).toBe(`gachahub/session-link/v1\n`);
  });
});
