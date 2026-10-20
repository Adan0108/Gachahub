import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryPlatformCasesDto } from './query-platform-cases.dto';
import { QueryModerationCasesDto } from '../query-moderation-cases.dto';
import { QueryCaseReportsDto } from '../query-case-reports.dto';

describe('Native case query DTOs', () => {
  it('defaults scope and bounded pagination', () => {
    expect(plainToInstance(QueryPlatformCasesDto, {})).toMatchObject({
      scope: 'all',
      limit: 20,
    });
    expect(plainToInstance(QueryCaseReportsDto, {}).limit).toBe(20);
  });
  it.each([
    {},
    { scope: 'all' },
    { scope: 'platform' },
    { scope: 'game', gameSlug: 'slug' },
    { status: 'OPEN', targetType: 'POST', limit: '100' },
    { status: 'IN_REVIEW', targetType: 'COMMENT' },
    { status: 'RESOLVED' },
    { status: 'DISMISSED' },
    { cursor: 'opaque-boundary', limit: '50' },
  ])('accepts native filters %j', async (query) => {
    expect(
      await validate(plainToInstance(QueryPlatformCasesDto, query), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);
  });
  it.each([
    { scope: 'bad' },
    { status: 'PENDING' },
    { targetType: 'USER' },
    { gameSlug: ['x'] },
    { page: 0 },
    { page: 501 },
    { limit: 101 },
    { limit: 1.5 },
    { gameSlug: 'x'.repeat(201) },
    { pagination: 'offset' },
    { cursor: ['bad'] },
    { cursor: 'x'.repeat(1025) },
  ])('rejects %j', async (query) => {
    expect(
      (
        await validate(plainToInstance(QueryPlatformCasesDto, query), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { cursor: 7 },
    { cursor: 'x'.repeat(1025) },
  ])('rejects invalid evidence query %j', async (query) => {
    expect(
      (
        await validate(plainToInstance(QueryCaseReportsDto, query), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });
});

// Native endpoints must reject old pagination keys even when their values look valid.
it.each([QueryPlatformCasesDto, QueryModerationCasesDto, QueryCaseReportsDto])(
  '%p rejects numbered pagination and metadata as query input',
  async (Dto) => {
    for (const query of [
      { page: 1 },
      { pagination: 'cursor' },
      { totalPages: 2 },
    ]) {
      expect(
        await validate(plainToInstance(Dto, query), {
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      ).not.toHaveLength(0);
    }
  },
);
