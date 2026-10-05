import { BadRequestException } from '@nestjs/common';
import {
  decodeLatestFeedCursor,
  encodeLatestFeedCursor,
} from './feed-cursor.util';

describe('Latest feed cursor', () => {
  it('round-trips both parts of the chronological continuation key', () => {
    const cursor = {
      createdAt: new Date('2026-09-29T01:02:03.456Z'),
      id: 'post-42',
    };

    expect(decodeLatestFeedCursor(encodeLatestFeedCursor(cursor))).toEqual(
      cursor,
    );
  });

  it.each([
    '',
    'not+base64url',
    Buffer.from('not json').toString('base64url'),
    Buffer.from(
      JSON.stringify({ createdAt: 'invalid', id: 'post-1' }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({ createdAt: '2026-09-29T00:00:00.000Z', id: '' }),
    ).toString('base64url'),
  ])('rejects malformed cursor %p', (cursor) => {
    expect(() => decodeLatestFeedCursor(cursor)).toThrow(BadRequestException);
  });
});
