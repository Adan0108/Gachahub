import { describe, expect, it } from 'vitest';
import type { RatchetTree } from 'ts-mls';
import { encodeIdentity } from './identityCodec';
import { diffLeafMembership } from './leafMembership';

function key(...bytes: number[]) {
  return new Uint8Array(bytes);
}

function leaf(userId: string, deviceId: string, signaturePublicKey = key(1)) {
  return {
    nodeType: 'leaf',
    leaf: {
      credential: { credentialType: 'basic', identity: encodeIdentity(userId, deviceId) },
      signaturePublicKey,
    },
  };
}

function undecodableLeaf(signaturePublicKey = key(9)) {
  return {
    nodeType: 'leaf',
    leaf: {
      credential: { credentialType: 'basic', identity: new TextEncoder().encode('not json') },
      signaturePublicKey,
    },
  };
}

/** Real trees interleave leaves with parent/blank nodes; only leaves matter here. */
function tree(...leaves: unknown[]): RatchetTree {
  return leaves.flatMap((node) => [node, undefined]) as unknown as RatchetTree;
}

describe('diffLeafMembership', () => {
  it('reports nothing for an unchanged tree', () => {
    const t = tree(leaf('u1', 'd1'), leaf('u2', 'd2'));

    expect(diffLeafMembership(t, t)).toEqual({ added: [], removed: [] });
  });

  it('reports an added leaf with its signature key', () => {
    const before = tree(leaf('u1', 'd1'));
    const after = tree(leaf('u1', 'd1'), leaf('u2', 'd2', key(2)));

    expect(diffLeafMembership(before, after)).toEqual({
      added: [{ userId: 'u2', deviceId: 'd2', signatureKey: key(2) }],
      removed: [],
    });
  });

  it('reports a removed leaf', () => {
    const before = tree(leaf('u1', 'd1'), leaf('u2', 'd2'));
    const after = tree(leaf('u1', 'd1'));

    expect(diffLeafMembership(before, after)).toEqual({
      added: [],
      removed: [{ userId: 'u2', deviceId: 'd2', signatureKey: key(1) }],
    });
  });

  it('reports a device that came back under a different signature key as removed AND added', () => {
    const before = tree(leaf('u1', 'd1', key(1)));
    const after = tree(leaf('u1', 'd1', key(2)));

    const change = diffLeafMembership(before, after);

    expect(change?.removed).toEqual([{ userId: 'u1', deviceId: 'd1', signatureKey: key(1) }]);
    expect(change?.added).toEqual([{ userId: 'u1', deviceId: 'd1', signatureKey: key(2) }]);
  });

  it('does not collapse the same device added twice into one', () => {
    const before = tree(leaf('u1', 'd1'));
    const after = tree(leaf('u1', 'd1'), leaf('u2', 'd2'), leaf('u2', 'd2'));

    expect(diffLeafMembership(before, after)?.added).toHaveLength(2);
  });

  it('ignores blank and parent nodes', () => {
    const before = [undefined, undefined] as unknown as RatchetTree;
    const after = [undefined, { nodeType: 'parent' }, undefined] as unknown as RatchetTree;

    expect(diffLeafMembership(before, after)).toEqual({ added: [], removed: [] });
  });

  it('returns undefined when an added leaf has an undecodable credential', () => {
    const before = tree(leaf('u1', 'd1'));
    const after = tree(leaf('u1', 'd1'), undecodableLeaf());

    expect(diffLeafMembership(before, after)).toBeUndefined();
  });

  it('omits a removed leaf whose credential was undecodable instead of failing', () => {
    const before = tree(leaf('u1', 'd1'), undecodableLeaf());
    const after = tree(leaf('u1', 'd1'));

    expect(diffLeafMembership(before, after)).toEqual({ added: [], removed: [] });
  });

  it('does not treat an already-present undecodable leaf as a change', () => {
    const t = tree(leaf('u1', 'd1'), undecodableLeaf());

    expect(diffLeafMembership(t, t)).toEqual({ added: [], removed: [] });
  });
});
