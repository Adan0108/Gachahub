import { describe, expect, it } from 'vitest';
import type { DeviceCredential } from '../contract/types';
import { describeMembershipMismatch, parseDeclaredMembership } from './declaredMembership';

const credential = (deviceId: string): DeviceCredential => ({
  userId: `user-of-${deviceId}`,
  deviceId,
  signatureKey: new Uint8Array([1]),
});

const declared = (added: string[], removed: string[]) => ({
  membershipDeclared: true,
  addedDeviceIds: added,
  removedDeviceIds: removed,
});

describe('parseDeclaredMembership', () => {
  it('reads a well-formed handshake row', () => {
    expect(
      parseDeclaredMembership({
        id: 'hs-1',
        membershipDeclared: true,
        addedDeviceIds: ['d1'],
        removedDeviceIds: [],
      }),
    ).toEqual({ membershipDeclared: true, addedDeviceIds: ['d1'], removedDeviceIds: [] });
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['no fields at all', { id: 'hs-1' }],
    ['a missing flag', { addedDeviceIds: [], removedDeviceIds: [] }],
    ['a non-boolean flag', { membershipDeclared: 'yes', addedDeviceIds: [], removedDeviceIds: [] }],
    ['missing added', { membershipDeclared: true, removedDeviceIds: [] }],
    [
      'added that is not an array',
      { membershipDeclared: true, addedDeviceIds: 'd1', removedDeviceIds: [] },
    ],
    [
      'a non-string device id',
      { membershipDeclared: true, addedDeviceIds: [1], removedDeviceIds: [] },
    ],
  ])(
    'returns undefined for %s, so leaving fields out is never read as "nothing to check"',
    (_n, row) => {
      expect(parseDeclaredMembership(row)).toBeUndefined();
    },
  );
});

describe('describeMembershipMismatch', () => {
  it('agrees when what happened is what was declared', () => {
    expect(
      describeMembershipMismatch(
        { added: [credential('a')], removed: [credential('r')] },
        declared(['a'], ['r']),
      ),
    ).toBeUndefined();
  });

  it('agrees regardless of order', () => {
    expect(
      describeMembershipMismatch(
        { added: [credential('a'), credential('b')], removed: [] },
        declared(['b', 'a'], []),
      ),
    ).toBeUndefined();
  });

  it('agrees for a Commit that changed no one', () => {
    expect(
      describeMembershipMismatch({ added: [], removed: [] }, declared([], [])),
    ).toBeUndefined();
  });

  it('flags a device added that was not declared', () => {
    expect(
      describeMembershipMismatch({ added: [credential('sneaky')], removed: [] }, declared([], [])),
    ).toMatch(/added \[sneaky\] but declared \[\]/);
  });

  it('flags a declared add that did not happen', () => {
    expect(describeMembershipMismatch({ added: [], removed: [] }, declared(['a'], []))).toMatch(
      /added \[\] but declared \[a\]/,
    );
  });

  it('flags a device removed that was not declared', () => {
    expect(
      describeMembershipMismatch({ added: [], removed: [credential('victim')] }, declared([], [])),
    ).toMatch(/removed \[victim\] but declared \[\]/);
  });

  it('flags a declared removal that did not happen', () => {
    expect(describeMembershipMismatch({ added: [], removed: [] }, declared([], ['r']))).toMatch(
      /removed \[\] but declared \[r\]/,
    );
  });

  it('flags a different device than the one declared', () => {
    expect(
      describeMembershipMismatch({ added: [credential('a')], removed: [] }, declared(['b'], [])),
    ).toBeDefined();
  });

  it('flags the same device added twice against one declared', () => {
    expect(
      describeMembershipMismatch(
        { added: [credential('a'), credential('a')], removed: [] },
        declared(['a'], []),
      ),
    ).toBeDefined();
  });

  it('flags a Commit that could not report what it did, when something was declared', () => {
    expect(describeMembershipMismatch(null, declared([], []))).toMatch(/did not report/);
  });

  it('has nothing to check for a Commit accepted before membership was tracked', () => {
    expect(
      describeMembershipMismatch(
        { added: [credential('anything')], removed: [] },
        { membershipDeclared: false, addedDeviceIds: [], removedDeviceIds: [] },
      ),
    ).toBeUndefined();
    expect(
      describeMembershipMismatch(null, {
        membershipDeclared: false,
        addedDeviceIds: [],
        removedDeviceIds: [],
      }),
    ).toBeUndefined();
  });
});
