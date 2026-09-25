import { describe, expect, it } from 'vitest';
import { markVerified, statusOf, type DeviceKey, type PeerVerification } from './verificationState';

const key = { ownUserId: 'alice', peerUserId: 'bob' };
const dev = (deviceId: string, signatureKey: string): DeviceKey => ({ deviceId, signatureKey });
const verifiedRecord = (...devices: DeviceKey[]): PeerVerification => ({ ...key, devices });

describe('statusOf', () => {
  it('is unverified with no record or no devices', () => {
    expect(statusOf(undefined, [dev('b1', 'aa')])).toBe('unverified');
    expect(statusOf(verifiedRecord(dev('b1', 'aa')), [])).toBe('unverified');
  });

  it('is verified when every current device is verified', () => {
    expect(statusOf(verifiedRecord(dev('b1', 'aa'), dev('b2', 'bb')), [dev('b1', 'aa'), dev('b2', 'bb')])).toBe('verified');
  });

  it('is new-device, not changed, when a device is added', () => {
    expect(statusOf(verifiedRecord(dev('b1', 'aa')), [dev('b1', 'aa'), dev('b2', 'bb')])).toBe('new-device');
  });

  it('ignores a retired verified device', () => {
    expect(statusOf(verifiedRecord(dev('b1', 'aa'), dev('b2', 'bb')), [dev('b1', 'aa')])).toBe('verified');
  });

  it('is new-device when the only verified device retired and another appeared', () => {
    expect(statusOf(verifiedRecord(dev('b1', 'aa')), [dev('b2', 'bb')])).toBe('new-device');
  });

  it('is changed when a verified device id presents a different key', () => {
    expect(statusOf(verifiedRecord(dev('b1', 'aa')), [dev('b1', 'cc')])).toBe('changed');
  });

  it('prefers changed over new-device', () => {
    expect(statusOf(verifiedRecord(dev('b1', 'aa')), [dev('b1', 'cc'), dev('b2', 'bb')])).toBe('changed');
  });
});

describe('markVerified', () => {
  it('adds current devices and keeps earlier verified ones', () => {
    const next = markVerified(verifiedRecord(dev('b1', 'aa')), key, [dev('b2', 'bb')]);
    expect(next.devices).toEqual([dev('b1', 'aa'), dev('b2', 'bb')]);
  });

  it('replaces a device id with its new key, clearing changed', () => {
    const next = markVerified(verifiedRecord(dev('b1', 'aa')), key, [dev('b1', 'cc')]);
    expect(next.devices).toEqual([dev('b1', 'cc')]);
    expect(statusOf(next, [dev('b1', 'cc')])).toBe('verified');
  });
});
