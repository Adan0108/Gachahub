import { describe, expect, it } from 'vitest';
import { describeTreeMismatch, parseRoster, type RosterLeaf } from './rosterCheck';
import { bytesToBase64 } from '../storage/base64';

const key = (...bytes: number[]) => new Uint8Array(bytes);
const treeLeaf = (userId: string, deviceId: string, signatureKey = key(1)) => ({
  userId,
  deviceId,
  signatureKey,
});
const rosterLeaf = (
  userId: string,
  deviceId: string,
  signatureKey: Uint8Array | null = key(1),
): RosterLeaf => ({ userId, deviceId, signatureKey });

describe('describeTreeMismatch', () => {
  it('agrees when every leaf matches the roster', () => {
    expect(
      describeTreeMismatch(
        [treeLeaf('u1', 'd1'), treeLeaf('u2', 'd2', key(2))],
        [rosterLeaf('u1', 'd1'), rosterLeaf('u2', 'd2', key(2))],
      ),
    ).toBeUndefined();
  });

  it('refuses a founder leaf labelled as someone else', () => {
    expect(
      describeTreeMismatch([treeLeaf('victim', 'd1')], [rosterLeaf('attacker', 'd1')]),
    ).toMatch(/labelled as user victim/);
  });

  it('refuses a leaf that carries a different key than the device registered', () => {
    expect(
      describeTreeMismatch([treeLeaf('u1', 'd1', key(9))], [rosterLeaf('u1', 'd1', key(1))]),
    ).toMatch(/registered key/);
  });

  it('refuses a leaf for a device the server does not have in the group', () => {
    expect(
      describeTreeMismatch(
        [treeLeaf('u1', 'd1'), treeLeaf('u1', 'ghost')],
        [rosterLeaf('u1', 'd1')],
      ),
    ).toMatch(/ghost/);
  });

  it('refuses a group missing a device the server has in it', () => {
    expect(
      describeTreeMismatch(
        [treeLeaf('u1', 'd1')],
        [rosterLeaf('u1', 'd1'), rosterLeaf('u2', 'd2')],
      ),
    ).toMatch(/d2/);
  });

  it('refuses the same device twice', () => {
    expect(
      describeTreeMismatch([treeLeaf('u1', 'd1'), treeLeaf('u1', 'd1')], [rosterLeaf('u1', 'd1')]),
    ).toMatch(/more than one leaf/);
  });

  it('still checks the owner of a leaf whose device record is gone, but has no key to compare', () => {
    expect(
      describeTreeMismatch([treeLeaf('u1', 'd1', key(5))], [rosterLeaf('u1', 'd1', null)]),
    ).toBeUndefined();
    expect(
      describeTreeMismatch([treeLeaf('u2', 'd1', key(5))], [rosterLeaf('u1', 'd1', null)]),
    ).toMatch(/labelled as user u2/);
  });

  it('refuses a group with a leaf it cannot read', () => {
    expect(describeTreeMismatch(undefined, [])).toMatch(/cannot be read/);
  });
});

describe('parseRoster', () => {
  it('reads leaves, with a missing key as null', () => {
    expect(
      parseRoster({
        leaves: [
          { deviceId: 'd1', userId: 'u1', signaturePublicKey: bytesToBase64(key(1)) },
          { deviceId: 'd2', userId: 'u2', signaturePublicKey: null },
        ],
      }),
    ).toEqual([rosterLeaf('u1', 'd1', key(1)), rosterLeaf('u2', 'd2', null)]);
  });

  it('gives undefined for a reply that is not a roster, never an empty group', () => {
    expect(parseRoster(undefined)).toBeUndefined();
    expect(parseRoster({})).toBeUndefined();
    expect(parseRoster({ leaves: [{ deviceId: 1 }] })).toBeUndefined();
  });
});
