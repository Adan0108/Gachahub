import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuerySavedPostsDto } from './query-saved-posts.dto';
import { encodeSavedPostCursor } from '../saved-post-cursor.util';

describe('QuerySavedPostsDto', () => {
  it('defaults to 20 with an omitted cursor', async () => {
    const dto = plainToInstance(QuerySavedPostsDto, {});
    expect(dto.limit).toBe(20);
    expect(dto.cursor).toBeUndefined();
    expect(await validate(dto)).toEqual([]);
  });
  it.each(['1', '20', '100'])(
    'transforms valid query limit %s into a number',
    async (limit) => {
      const dto = plainToInstance(QuerySavedPostsDto, { limit });
      expect(dto.limit).toBe(Number(limit));
      expect(await validate(dto)).toEqual([]);
    },
  );
  it.each(['0', '101', '1.5', 'abc', ''])(
    'rejects invalid limit %s',
    async (limit) => {
      expect(
        await validate(plainToInstance(QuerySavedPostsDto, { limit })),
      ).not.toEqual([]);
    },
  );
  it('accepts an opaque cursor unchanged', async () => {
    const cursor = encodeSavedPostCursor({
      savedAt: new Date('2026-10-06T00:00:00.000Z'),
      postId: 'post',
    });
    const dto = plainToInstance(QuerySavedPostsDto, { cursor });
    expect(dto.cursor).toBe(cursor);
    expect(await validate(dto)).toEqual([]);
  });
  it.each([123, 'a'.repeat(1001)])(
    'rejects invalid cursor type or length %#',
    async (cursor) => {
      expect(
        await validate(plainToInstance(QuerySavedPostsDto, { cursor })),
      ).not.toEqual([]);
    },
  );
});
