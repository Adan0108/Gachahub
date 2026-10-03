import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  QueryForYouFeedDto,
  QueryLatestFeedDto,
  QueryTrendingFeedDto,
} from './query-feed.dto';

describe('QueryForYouFeedDto', () => {
  it('accepts limit, cursor, and type for For You continuation', async () => {
    const query = plainToInstance(QueryForYouFeedDto, {
      limit: '25',
      cursor: 'opaque-cursor',
      type: 'GUIDE',
    });

    await expect(
      validate(query, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).resolves.toHaveLength(0);
    expect(query.limit).toBe(25);
  });

  it('rejects legacy page pagination', async () => {
    const query = plainToInstance(QueryForYouFeedDto, {
      page: '2',
      limit: '20',
    });
    const errors = await validate(query, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([
      expect.objectContaining({
        property: 'page',
      }),
    ]);
  });
});

describe('QueryLatestFeedDto', () => {
  it('accepts limit and cursor for Latest pagination', async () => {
    const query = plainToInstance(QueryLatestFeedDto, {
      limit: '25',
      cursor: 'opaque-cursor',
      type: 'GUIDE',
    });

    await expect(
      validate(query, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).resolves.toHaveLength(0);
    expect(query.limit).toBe(25);
  });

  it('rejects the removed page parameter', async () => {
    const query = plainToInstance(QueryLatestFeedDto, {
      page: '2',
      limit: '20',
    });

    const errors = await validate(query, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([
      expect.objectContaining({
        property: 'page',
      }),
    ]);
  });
});

describe('QueryTrendingFeedDto', () => {
  it('accepts limit and cursor for Trending continuation', async () => {
    const query = plainToInstance(QueryTrendingFeedDto, {
      limit: '25',
      cursor: 'opaque-cursor',
      type: 'GUIDE',
    });

    await expect(
      validate(query, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).resolves.toHaveLength(0);
    expect(query.limit).toBe(25);
  });

  it('rejects page pagination on global Trending', async () => {
    const query = plainToInstance(QueryTrendingFeedDto, {
      page: '2',
      limit: '20',
    });

    const errors = await validate(query, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([
      expect.objectContaining({
        property: 'page',
      }),
    ]);
  });
});
