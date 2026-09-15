import { BadRequestException } from '@nestjs/common';
import { buildTestKeyPackage as buildKeyPackage } from './test-support/build-key-package';
import {
  decodeAndVerifyKeyPackage,
  PINNED_CIPHERSUITE,
} from './mls-key-package.util';

describe('decodeAndVerifyKeyPackage', () => {
  it('accepts a real key package matching the expected identity', async () => {
    const payload = await buildKeyPackage('user-1', 'device-1');

    const result = await decodeAndVerifyKeyPackage(payload, {
      userId: 'user-1',
      deviceId: 'device-1',
    });

    expect(result.cipherSuite).toBe(PINNED_CIPHERSUITE);
  });

  it('rejects malformed bytes', async () => {
    const garbage = new TextEncoder().encode('not a key package');

    await expect(
      decodeAndVerifyKeyPackage(garbage, {
        userId: 'user-1',
        deviceId: 'device-1',
      }),
    ).rejects.toThrow('Not a valid MLS key package');
  });

  it('rejects a credential that does not match the expected userId/deviceId', async () => {
    const payload = await buildKeyPackage('user-1', 'device-1');

    await expect(
      decodeAndVerifyKeyPackage(payload, {
        userId: 'user-1',
        deviceId: 'a-different-device',
      }),
    ).rejects.toThrow(
      'Key package credential does not match the authenticated user/device',
    );
  });

  it('rejects a key package signed under an unsupported ciphersuite', async () => {
    // MLS_128_DHKEMP256_AES128GCM_SHA256_P256 also needs zero-extra deps
    // beyond @noble/curves (already installed) - a real, differently-signed
    // key package, not just a tampered field.
    const payload = await buildKeyPackage('user-1', 'device-1', {
      ciphersuite: 'MLS_128_DHKEMP256_AES128GCM_SHA256_P256',
    });

    await expect(
      decodeAndVerifyKeyPackage(payload, {
        userId: 'user-1',
        deviceId: 'device-1',
      }),
    ).rejects.toThrow(/Unsupported ciphersuite/);
  });

  it('rejects a tampered signature', async () => {
    const payload = await buildKeyPackage('user-1', 'device-1');
    // flip a byte near the end, where the signature lives in the TLS encoding
    const tampered = new Uint8Array(payload);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(
      decodeAndVerifyKeyPackage(tampered, {
        userId: 'user-1',
        deviceId: 'device-1',
      }),
    ).rejects.toThrow(/signature is invalid|Not a valid MLS key package/);
  });

  // regression: ts-mls's decoder throws (CodecError) on truncated
  // variable-length fields instead of returning undefined - this must
  // still surface as a clean BadRequestException, not an unhandled 500
  it('rejects a truncated real key package as a BadRequestException, not an unhandled throw', async () => {
    const payload = await buildKeyPackage('user-1', 'device-1');
    const truncated = payload.slice(0, Math.floor(payload.length * 0.4));

    await expect(
      decodeAndVerifyKeyPackage(truncated, {
        userId: 'user-1',
        deviceId: 'device-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a key package with an out-of-bounds lifetime', async () => {
    const farFuture = BigInt(
      Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    );
    const payload = await buildKeyPackage('user-1', 'device-1', {
      lifetime: { notBefore: 0n, notAfter: farFuture },
    });

    await expect(
      decodeAndVerifyKeyPackage(payload, {
        userId: 'user-1',
        deviceId: 'device-1',
      }),
    ).rejects.toThrow(/lifetime must be positive and at most/);
  });
});
