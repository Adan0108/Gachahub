import { BadRequestException } from '@nestjs/common';
import { buildTestKeyPackage } from './test-support/build-key-package';
import {
  decodeAndVerifyKeyPackage,
  PINNED_CIPHERSUITE,
} from './mls-key-package.util';

describe('decodeAndVerifyKeyPackage', () => {
  it('accepts a real key package matching the expected identity', async () => {
    const { payload, signaturePublicKey } = await buildTestKeyPackage(
      'user-1',
      'device-1',
    );

    const result = await decodeAndVerifyKeyPackage(payload, {
      userId: 'user-1',
      deviceId: 'device-1',
      signaturePublicKey,
    });

    expect(result.cipherSuite).toBe(PINNED_CIPHERSUITE);
  });

  it('rejects malformed bytes', async () => {
    const garbage = new TextEncoder().encode('not a key package');

    await expect(
      decodeAndVerifyKeyPackage(garbage, {
        userId: 'user-1',
        deviceId: 'device-1',
        signaturePublicKey: new Uint8Array(),
      }),
    ).rejects.toThrow('Not a valid MLS key package');
  });

  it('rejects a credential that does not match the expected userId/deviceId', async () => {
    const { payload, signaturePublicKey } = await buildTestKeyPackage(
      'user-1',
      'device-1',
    );

    await expect(
      decodeAndVerifyKeyPackage(payload, {
        userId: 'user-1',
        deviceId: 'a-different-device',
        signaturePublicKey,
      }),
    ).rejects.toThrow(
      'Key package credential does not match the authenticated user/device',
    );
  });

  // regression: the device's registered signaturePublicKey used to never be
  // checked against what the key package was actually signed with
  it("rejects a key package not signed with the device's registered signature key", async () => {
    const { payload } = await buildTestKeyPackage('user-1', 'device-1');
    const unrelatedKey = (await buildTestKeyPackage('user-1', 'device-1'))
      .signaturePublicKey;

    await expect(
      decodeAndVerifyKeyPackage(payload, {
        userId: 'user-1',
        deviceId: 'device-1',
        signaturePublicKey: unrelatedKey,
      }),
    ).rejects.toThrow(
      "Key package is not signed with this device's registered signature key",
    );
  });

  it('rejects a key package signed under an unsupported ciphersuite', async () => {
    // MLS_128_DHKEMP256_AES128GCM_SHA256_P256 also needs zero-extra deps
    // beyond @noble/curves (already installed) - a real, differently-signed
    // key package, not just a tampered field.
    const { payload, signaturePublicKey } = await buildTestKeyPackage(
      'user-1',
      'device-1',
      { ciphersuite: 'MLS_128_DHKEMP256_AES128GCM_SHA256_P256' },
    );

    await expect(
      decodeAndVerifyKeyPackage(payload, {
        userId: 'user-1',
        deviceId: 'device-1',
        signaturePublicKey,
      }),
    ).rejects.toThrow(/Unsupported ciphersuite/);
  });

  it('rejects a tampered signature', async () => {
    const { payload, signaturePublicKey } = await buildTestKeyPackage(
      'user-1',
      'device-1',
    );
    // flip a byte near the end, where the signature lives in the TLS encoding
    const tampered = new Uint8Array(payload);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(
      decodeAndVerifyKeyPackage(tampered, {
        userId: 'user-1',
        deviceId: 'device-1',
        signaturePublicKey,
      }),
    ).rejects.toThrow(/signature is invalid|Not a valid MLS key package/);
  });

  // regression: ts-mls's decoder throws (CodecError) on truncated
  // variable-length fields instead of returning undefined - this must
  // still surface as a clean BadRequestException, not an unhandled 500
  it('rejects a truncated real key package as a BadRequestException, not an unhandled throw', async () => {
    const { payload, signaturePublicKey } = await buildTestKeyPackage(
      'user-1',
      'device-1',
    );
    const truncated = payload.slice(0, Math.floor(payload.length * 0.4));

    await expect(
      decodeAndVerifyKeyPackage(truncated, {
        userId: 'user-1',
        deviceId: 'device-1',
        signaturePublicKey,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a key package with an out-of-bounds lifetime', async () => {
    const farFuture = BigInt(
      Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    );
    const { payload, signaturePublicKey } = await buildTestKeyPackage(
      'user-1',
      'device-1',
      { lifetime: { notBefore: 0n, notAfter: farFuture } },
    );

    await expect(
      decodeAndVerifyKeyPackage(payload, {
        userId: 'user-1',
        deviceId: 'device-1',
        signaturePublicKey,
      }),
    ).rejects.toThrow(/lifetime must be positive and at most/);
  });

  // regression: duration alone isn't enough - a short-duration window
  // scheduled far in the future used to pass, since expiresAt was derived
  // only from notAfter with no check that notBefore had actually arrived
  it('rejects a short-duration key package scheduled to start far in the future', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const notBefore = now + BigInt(300 * 24 * 60 * 60);
    const notAfter = notBefore + BigInt(89 * 24 * 60 * 60);
    const { payload, signaturePublicKey } = await buildTestKeyPackage(
      'user-1',
      'device-1',
      { lifetime: { notBefore, notAfter } },
    );

    await expect(
      decodeAndVerifyKeyPackage(payload, {
        userId: 'user-1',
        deviceId: 'device-1',
        signaturePublicKey,
      }),
    ).rejects.toThrow(/not valid yet/);
  });

  // regression: a window that already fully elapsed before it was ever
  // uploaded (both notBefore and notAfter in the past) used to pass, since
  // only the duration and notBefore-in-the-future cases were checked
  it('rejects a key package whose lifetime has already fully elapsed', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const notBefore = now - BigInt(100 * 24 * 60 * 60);
    const notAfter = notBefore + BigInt(30 * 24 * 60 * 60);
    const { payload, signaturePublicKey } = await buildTestKeyPackage(
      'user-1',
      'device-1',
      { lifetime: { notBefore, notAfter } },
    );

    await expect(
      decodeAndVerifyKeyPackage(payload, {
        userId: 'user-1',
        deviceId: 'device-1',
        signaturePublicKey,
      }),
    ).rejects.toThrow(/already expired/);
  });
});
