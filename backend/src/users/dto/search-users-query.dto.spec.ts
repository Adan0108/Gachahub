import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchUsersQueryDto } from './search-users-query.dto';

const check = async (plain: object) => {
  const dto = plainToInstance(SearchUsersQueryDto, plain);
  return { dto, errors: await validate(dto) };
};

describe('SearchUsersQueryDto', () => {
  it('trims q and defaults limit to 8', async () => {
    const { dto, errors } = await check({ q: '  ma  ' });
    expect(errors).toHaveLength(0);
    expect(dto.q).toBe('ma');
    expect(dto.limit).toBe(8);
  });

  it.each([
    {},
    { q: ' a ' },
    { q: 'x'.repeat(51) },
    { q: 'ab', limit: '0' },
    { q: 'ab', limit: '21' },
    { q: 'ab', limit: 'x' },
  ])('rejects %j', async (plain) => {
    expect((await check(plain)).errors.length).toBeGreaterThan(0);
  });

  it('coerces limit from the query string', async () => {
    const { dto, errors } = await check({ q: 'ab', limit: '20' });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(20);
  });
});
