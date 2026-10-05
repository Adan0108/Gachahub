import { BadRequestException } from '@nestjs/common';
import {
  decodeForYouFeedCursor,
  encodeForYouFeedCursor,
} from './for-you-cursor.util';

describe('For You feed cursor', () => {
  const snapshotId = '123e4567-e89b-42d3-a456-426614174000';

  it('round-trips a snapshot continuation position', () => {
    const cursor = { snapshotId, offset: 20 };

    expect(decodeForYouFeedCursor(encodeForYouFeedCursor(cursor))).toEqual(
      cursor,
    );
  });

  it.each([
    '',
    'not+base64url',
    Buffer.from('not json').toString('base64url'),
    Buffer.from(JSON.stringify({ offset: 20 })).toString('base64url'),
    Buffer.from(JSON.stringify({ snapshotId })).toString('base64url'),
    Buffer.from(
      JSON.stringify({ snapshotId: 'not-a-uuid', offset: 20 }),
    ).toString('base64url'),
    Buffer.from(JSON.stringify({ snapshotId, offset: -1 })).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify({ snapshotId, offset: 0 })).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify({ snapshotId, offset: 1.5 })).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify({ snapshotId, offset: 401 })).toString(
      'base64url',
    ),
    Buffer.from(
      JSON.stringify({ snapshotId, offset: 20, extra: true }),
    ).toString('base64url'),
  ])('rejects malformed cursor %p', (cursor) => {
    expect(() => decodeForYouFeedCursor(cursor)).toThrow(BadRequestException);
  });
});
