import { BadRequestException } from '@nestjs/common';

export interface SavedPostCursor {
  savedAt: Date;
  postId: string;
}

export function encodeSavedPostCursor(cursor: SavedPostCursor): string {
  return Buffer.from(
    JSON.stringify({
      savedAt: cursor.savedAt.toISOString(),
      postId: cursor.postId,
    }),
  ).toString('base64url');
}

export function decodeSavedPostCursor(raw: string): SavedPostCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const value: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    if (
      typeof value !== 'object' ||
      value === null ||
      !('savedAt' in value) ||
      !('postId' in value) ||
      typeof value.savedAt !== 'string' ||
      typeof value.postId !== 'string' ||
      !value.postId.length
    )
      throw new Error();
    const savedAt = new Date(value.savedAt);
    if (
      Number.isNaN(savedAt.getTime()) ||
      savedAt.toISOString() !== value.savedAt
    )
      throw new Error();
    return { savedAt, postId: value.postId };
  } catch {
    throw new BadRequestException('Invalid saved posts cursor');
  }
}
