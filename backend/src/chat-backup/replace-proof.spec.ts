import { computeBackupProof, proofMatches } from './replace-proof';

// The same vector is asserted in the frontend's backupCrypto.test.ts, so the two sides cannot drift.
const VECTOR = 'vFpeZotdsgzGcuhopWvFH9uMhoYEutxFH5/9p7XGJmY=';

describe('replace proof', () => {
  const parts = {
    userId: 'u1',
    nonce: 'bm9uY2U=',
    keyCheck: 'a2V5Y2hlY2s=',
    replaceSecret: 'c2VjcmV0',
  };

  it('matches the cross-side test vector', () => {
    expect(
      computeBackupProof(Buffer.alloc(32, 9), 'replace', parts).toString(
        'base64',
      ),
    ).toBe(VECTOR);
  });

  it('changes when any bound value changes', () => {
    const secret = Buffer.alloc(32, 9);
    const base = computeBackupProof(secret, 'replace', parts);

    for (const key of Object.keys(parts) as (keyof typeof parts)[]) {
      const changed = computeBackupProof(secret, 'replace', {
        ...parts,
        [key]: 'x',
      });
      expect(proofMatches(base, changed)).toBe(false);
    }
    expect(
      proofMatches(
        base,
        computeBackupProof(Buffer.alloc(32, 8), 'replace', parts),
      ),
    ).toBe(false);
  });

  it('matches the cross-side vectors for delete and cancel-delete', () => {
    const secret = Buffer.alloc(32, 9);
    const bare = { userId: 'u1', nonce: 'bm9uY2U=' };

    expect(computeBackupProof(secret, 'delete', bare).toString('base64')).toBe(
      'JLrcpB1L5pYqeNL2S6etYcxV84rQhATcGk4Pbwd4xGE=',
    );
    expect(
      computeBackupProof(secret, 'cancel-delete', bare).toString('base64'),
    ).toBe('sIUvZusisKH4Y5eMLmdJs6VasV+Y6/Aix1G9UA6VgyY=');
  });

  it('a proof for one action never verifies as another', () => {
    const secret = Buffer.alloc(32, 9);
    const bare = { userId: 'u1', nonce: 'bm9uY2U=' };

    expect(
      proofMatches(
        computeBackupProof(secret, 'delete', bare),
        computeBackupProof(secret, 'cancel-delete', bare),
      ),
    ).toBe(false);
    expect(
      proofMatches(
        computeBackupProof(secret, 'delete', bare),
        computeBackupProof(secret, 'replace', bare),
      ),
    ).toBe(false);
  });

  it('proofMatches rejects a different length without throwing', () => {
    expect(proofMatches(Buffer.alloc(32), Buffer.alloc(3))).toBe(false);
  });
});
