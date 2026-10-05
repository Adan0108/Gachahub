import { BadRequestException } from '@nestjs/common';

export interface ForYouFeedCursor {
  snapshotId: string;
  offset: number;
}

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const SNAPSHOT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Encodes a user-bound For You snapshot position as an opaque API cursor.
 */
export function encodeForYouFeedCursor(cursor: ForYouFeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * Decodes and strictly validates an opaque For You continuation cursor.
 */
export function decodeForYouFeedCursor(raw: string): ForYouFeedCursor {
  try {
    if (!CURSOR_PATTERN.test(raw)) {
      throw new Error('Cursor is not base64url');
    }

    const value: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );

    if (
      typeof value !== 'object' ||
      value === null ||
      !('snapshotId' in value) ||
      !('offset' in value) ||
      Object.keys(value).length !== 2 ||
      typeof value.snapshotId !== 'string' ||
      !SNAPSHOT_ID_PATTERN.test(value.snapshotId) ||
      typeof value.offset !== 'number' ||
      !Number.isInteger(value.offset) ||
      value.offset < 1 ||
      value.offset > 400
    ) {
      throw new Error('Cursor payload is invalid');
    }

    return {
      snapshotId: value.snapshotId,
      offset: value.offset,
    };
  } catch {
    throw new BadRequestException('Invalid For You feed cursor');
  }
}
