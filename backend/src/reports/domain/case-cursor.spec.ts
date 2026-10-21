import { decodeCaseCursor, encodeCaseCursor } from './case-cursor';
import { encodeEvidenceCursor } from './report-evidence-pagination';

describe('activity case cursor', () => {
  const cursor = {
    id: 'case',
    lastReportedAt: new Date('2026-10-21T00:00:00.000Z'),
  };
  it('round-trips the activity timestamp and id independently of evidence cursors', () => {
    expect(decodeCaseCursor(encodeCaseCursor(cursor))).toEqual(cursor);
    expect(
      decodeCaseCursor(
        encodeEvidenceCursor({
          id: 'report',
          createdAt: cursor.lastReportedAt,
        }),
      ),
    ).toBeNull();
  });
  it.each(['bad', '', 'x'.repeat(1025)])(
    'rejects malformed/bounded input',
    (value) => {
      expect(decodeCaseCursor(value)).toBeNull();
    },
  );
  it('rejects non-canonical timestamps and unknown orderings', () => {
    for (const value of [
      { order: 'lastReportedAt', id: 'case', lastReportedAt: '2026-10-21' },
      {
        order: 'updatedAt',
        id: 'case',
        lastReportedAt: cursor.lastReportedAt.toISOString(),
      },
    ]) {
      expect(
        decodeCaseCursor(
          Buffer.from(JSON.stringify(value)).toString('base64url'),
        ),
      ).toBeNull();
    }
  });
});
