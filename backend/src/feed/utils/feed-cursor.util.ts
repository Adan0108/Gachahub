import { BadRequestException } from '@nestjs/common';
import type { LatestFeedCursor } from '../feed.types';

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Encodes the complete chronological continuation key as an opaque cursor.
 */
export function encodeLatestFeedCursor(cursor: LatestFeedCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

/**
 * Decodes and validates an opaque Latest cursor before it reaches Prisma.
 */
export function decodeLatestFeedCursor(raw: string): LatestFeedCursor {
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
      !('createdAt' in value) ||
      !('id' in value) ||
      typeof value.createdAt !== 'string' ||
      typeof value.id !== 'string' ||
      value.id.length === 0
    ) {
      throw new Error('Cursor payload is invalid');
    }

    const createdAt = new Date(value.createdAt);

    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== value.createdAt
    ) {
      throw new Error('Cursor timestamp is invalid');
    }

    return {
      createdAt,
      id: value.id,
    };
  } catch {
    throw new BadRequestException('Invalid Latest feed cursor');
  }
}
