import { BadRequestException } from '@nestjs/common';
import {
  decodeTrendingFeedCursor,
  encodeTrendingFeedCursor,
} from './trending-cursor.util';

describe('Trending feed cursor', () => {
  it('round-trips a snapshot continuation position', () => {
    const cursor = {
      snapshotId: '123e4567-e89b-42d3-a456-426614174000',
      offset: 20,
    };

    expect(decodeTrendingFeedCursor(encodeTrendingFeedCursor(cursor))).toEqual(
      cursor,
    );
  });

  it.each([
    '',
    'not+base64url',
    Buffer.from('not json').toString('base64url'),
    Buffer.from(
      JSON.stringify({ snapshotId: 'not-a-uuid', offset: 20 }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        snapshotId: '123e4567-e89b-42d3-a456-426614174000',
        offset: 0,
      }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        snapshotId: '123e4567-e89b-42d3-a456-426614174000',
        offset: 201,
      }),
    ).toString('base64url'),
  ])('rejects malformed cursor %p', (cursor) => {
    expect(() => decodeTrendingFeedCursor(cursor)).toThrow(BadRequestException);
  });
});
