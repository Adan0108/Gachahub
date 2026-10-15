import { BadRequestException } from '@nestjs/common';
import {
  decodeSavedPostCursor,
  encodeSavedPostCursor,
} from './saved-post-cursor.util';

describe('saved cursor validation', () => {
  it('round trips', () => {
    const cursor = {
      savedAt: new Date('2026-10-06T00:00:00.000Z'),
      postId: 'post',
    };
    expect(decodeSavedPostCursor(encodeSavedPostCursor(cursor))).toEqual(
      cursor,
    );
  });
  it.each([
    '',
    '!',
    Buffer.from('null').toString('base64url'),
    Buffer.from(
      JSON.stringify({ savedAt: 'invalid', postId: 'post' }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({ savedAt: '2026-10-06', postId: 'post' }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({ savedAt: '2026-10-06T00:00:00.000Z', postId: '' }),
    ).toString('base64url'),
  ])('rejects invalid payload %s', (raw) => {
    expect(() => decodeSavedPostCursor(raw)).toThrow(BadRequestException);
  });
});

describe('saved cursor untrusted input', () => {
  const savedAt = '2026-10-06T00:00:00.000Z';
  it.each([
    '{',
    '{}',
    '[]',
    JSON.stringify({ postId: 'post' }),
    JSON.stringify({ savedAt }),
    JSON.stringify({ savedAt, postId: 1 }),
    JSON.stringify({ savedAt, postId: null }),
    JSON.stringify({ savedAt: 1, postId: 'post' }),
  ])('rejects malformed JSON or missing/invalid fields %#', (json) => {
    expect(() =>
      decodeSavedPostCursor(Buffer.from(json).toString('base64url')),
    ).toThrow(BadRequestException);
  });
  it('allows extra fields like the latest feed cursor and ignores them', () => {
    const raw = Buffer.from(
      JSON.stringify({ savedAt, postId: 'post', userId: 'victim' }),
    ).toString('base64url');
    expect(decodeSavedPostCursor(raw)).toEqual({
      savedAt: new Date(savedAt),
      postId: 'post',
    });
  });
});
