import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryPlatformReportsDto } from './query-platform-reports.dto';

describe('QueryPlatformReportsDto', () => {
  it('defaults scope and pagination', () => {
    expect(plainToInstance(QueryPlatformReportsDto, {})).toMatchObject({
      scope: 'all',
      page: 1,
      limit: 20,
    });
  });
  it.each([
    {},
    { scope: 'all' },
    { scope: 'platform' },
    { scope: 'game', gameSlug: 'slug' },
    { status: 'PENDING', targetType: 'POST', page: '2', limit: '100' },
  ])('accepts %j', async (query) => {
    expect(
      await validate(plainToInstance(QueryPlatformReportsDto, query)),
    ).toHaveLength(0);
  });
  it.each([
    { scope: 'bad' },
    { status: 'OPEN' },
    { targetType: 'USER' },
    { page: 0 },
    { page: 501 },
    { limit: 101 },
    { limit: 1.5 },
    { gameSlug: ['slug'] },
  ])('rejects %j', async (query) => {
    expect(
      (await validate(plainToInstance(QueryPlatformReportsDto, query))).length,
    ).toBeGreaterThan(0);
  });
});
