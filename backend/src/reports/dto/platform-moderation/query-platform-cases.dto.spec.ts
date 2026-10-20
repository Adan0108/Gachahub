import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryPlatformCasesDto } from './query-platform-cases.dto';
import { QueryCaseReportsDto } from '../query-case-reports.dto';

describe('Native case query DTOs', () => {
  it('defaults scope and bounded pagination', () => {
    expect(plainToInstance(QueryPlatformCasesDto, {})).toMatchObject({
      scope: 'all',
      page: 1,
      limit: 20,
    });
    expect(plainToInstance(QueryCaseReportsDto, {}).limit).toBe(20);
  });
  it.each([
    {},
    { scope: 'all' },
    { scope: 'platform' },
    { scope: 'game', gameSlug: 'slug' },
    { status: 'OPEN', targetType: 'POST', page: '2', limit: '100' },
    { status: 'IN_REVIEW', targetType: 'COMMENT' },
    { status: 'RESOLVED' },
    { status: 'DISMISSED' },
  ])('accepts native filters %j', async (query) => {
    expect(
      await validate(plainToInstance(QueryPlatformCasesDto, query)),
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
  ])('rejects %j', async (query) => {
    expect(
      (await validate(plainToInstance(QueryPlatformCasesDto, query))).length,
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
      (await validate(plainToInstance(QueryCaseReportsDto, query))).length,
    ).toBeGreaterThan(0);
  });
});
