import { describe, expect, it } from 'vitest';
import type { DeviceCredential } from '../contract/types';
import { bytesToBase64 } from '../storage/base64';
import {
  describeMembershipMismatch,
  parseDeclaredMembership,
  type DeclaredMembership,
} from './declaredMembership';

const KEY = new Uint8Array([1, 2, 3]);

const credential = (
  deviceId: string,
  userId = `user-of-${deviceId}`,
  signatureKey = KEY,
): DeviceCredential => ({ userId, deviceId, signatureKey });

const declared = (
  added: Array<{ deviceId: string; userId?: string; signatureKey?: Uint8Array }>,
  removed: Array<{ deviceId: string; userId?: string }> = [],
): DeclaredMembership => ({
  membershipDeclared: true,
  addedDevices: added.map((device) => ({
    deviceId: device.deviceId,
    userId: device.userId ?? `user-of-${device.deviceId}`,
    signatureKey: device.signatureKey ?? KEY,
  })),
  removedDevices: removed.map((device) => ({
    deviceId: device.deviceId,
    userId: device.userId ?? `user-of-${device.deviceId}`,
  })),
});

describe('parseDeclaredMembership', () => {
  it('reads a well-formed handshake row, decoding the attested keys', () => {
    expect(
      parseDeclaredMembership({
        id: 'hs-1',
        membershipDeclared: true,
        addedDevices: [{ deviceId: 'd1', userId: 'u1', signaturePublicKey: bytesToBase64(KEY) }],
        removedDevices: [{ deviceId: 'd2', userId: 'u2' }],
      }),
    ).toEqual({
      membershipDeclared: true,
      addedDevices: [{ deviceId: 'd1', userId: 'u1', signatureKey: KEY }],
      removedDevices: [{ deviceId: 'd2', userId: 'u2' }],
    });
  });

  const good = {
    membershipDeclared: true,
    addedDevices: [],
    removedDevices: [],
  };

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['no fields at all', { id: 'hs-1' }],
    ['a missing flag', { addedDevices: [], removedDevices: [] }],
    ['a non-boolean flag', { ...good, membershipDeclared: 'yes' }],
    ['missing added', { membershipDeclared: true, removedDevices: [] }],
    ['added that is not an array', { ...good, addedDevices: 'd1' }],
    [
      'an added device with no owner',
      { ...good, addedDevices: [{ deviceId: 'd', signaturePublicKey: 'AQ==' }] },
    ],
    ['an added device with no key', { ...good, addedDevices: [{ deviceId: 'd', userId: 'u' }] }],
    [
      'an added device whose key is not base64',
      { ...good, addedDevices: [{ deviceId: 'd', userId: 'u', signaturePublicKey: '***' }] },
    ],
    ['a removed device with no owner', { ...good, removedDevices: [{ deviceId: 'd' }] }],
    ['a bare device id instead of a record', { ...good, addedDevices: ['d1'] }],
  ])(
    'returns undefined for %s, so leaving fields out is never read as "nothing to check"',
    (_name, row) => {
      expect(parseDeclaredMembership(row)).toBeUndefined();
    },
  );
});

describe('describeMembershipMismatch', () => {
  it('agrees when what happened is what the server recorded', () => {
    expect(
      describeMembershipMismatch(
        { added: [credential('a')], removed: [credential('r')] },
        declared([{ deviceId: 'a' }], [{ deviceId: 'r' }]),
      ),
    ).toBeUndefined();
  });

  it('agrees regardless of order', () => {
    expect(
      describeMembershipMismatch(
        { added: [credential('a'), credential('b')], removed: [] },
        declared([{ deviceId: 'b' }, { deviceId: 'a' }]),
      ),
    ).toBeUndefined();
  });

  it('agrees for a Commit that changed no one', () => {
    expect(describeMembershipMismatch({ added: [], removed: [] }, declared([]))).toBeUndefined();
  });

  it('flags a device added that the server did not record', () => {
    expect(
      describeMembershipMismatch({ added: [credential('sneaky')], removed: [] }, declared([])),
    ).toMatch(/added \[sneaky\] but the server recorded \[\]/);
  });

  it('flags a recorded add that did not happen', () => {
    expect(
      describeMembershipMismatch({ added: [], removed: [] }, declared([{ deviceId: 'a' }])),
    ).toMatch(/added \[\] but the server recorded \[a\]/);
  });

  it('flags a device removed that the server did not record', () => {
    expect(
      describeMembershipMismatch({ added: [], removed: [credential('victim')] }, declared([])),
    ).toMatch(/removed \[victim\] but the server recorded \[\]/);
  });

  it('flags a recorded removal that did not happen', () => {
    expect(
      describeMembershipMismatch({ added: [], removed: [] }, declared([], [{ deviceId: 'r' }])),
    ).toMatch(/removed \[\] but the server recorded \[r\]/);
  });

  it('flags the same device added twice against one recorded', () => {
    expect(
      describeMembershipMismatch(
        { added: [credential('a'), credential('a')], removed: [] },
        declared([{ deviceId: 'a' }]),
      ),
    ).toBeDefined();
  });

  describe('a "ghost leaf": the right device id on the wrong credential', () => {
    it('flags a leaf labelled as a different user than the device belongs to', () => {
      expect(
        describeMembershipMismatch(
          { added: [credential('bobs-device', 'user-mallory')], removed: [] },
          declared([{ deviceId: 'bobs-device', userId: 'user-bob' }]),
        ),
      ).toMatch(/bobs-device is labelled as user user-mallory/);
    });

    it('flags a leaf that carries a different key than the one the device registered', () => {
      expect(
        describeMembershipMismatch(
          {
            added: [credential('bobs-device', 'user-bob', new Uint8Array([9, 9, 9]))],
            removed: [],
          },
          declared([{ deviceId: 'bobs-device', userId: 'user-bob' }]),
        ),
      ).toMatch(/does not carry that device's registered key/);
    });

    it('accepts the leaf when owner and key both match', () => {
      expect(
        describeMembershipMismatch(
          { added: [credential('bobs-device', 'user-bob')], removed: [] },
          declared([{ deviceId: 'bobs-device', userId: 'user-bob' }]),
        ),
      ).toBeUndefined();
    });

    it('flags a removed leaf whose label is not the user the server recorded', () => {
      expect(
        describeMembershipMismatch(
          { added: [], removed: [credential('d', 'user-mallory')] },
          declared([], [{ deviceId: 'd', userId: 'user-bob' }]),
        ),
      ).toMatch(/removed leaf for d is labelled as user user-mallory/);
    });
  });

  it('flags a Commit that could not report what it did, when something was declared', () => {
    expect(describeMembershipMismatch(null, declared([]))).toMatch(/did not report/);
  });

  it('has nothing to check for a Commit accepted before membership was tracked', () => {
    const legacy: DeclaredMembership = {
      membershipDeclared: false,
      addedDevices: [],
      removedDevices: [],
    };

    expect(
      describeMembershipMismatch({ added: [credential('anything')], removed: [] }, legacy),
    ).toBeUndefined();
    expect(describeMembershipMismatch(null, legacy)).toBeUndefined();
  });
});
