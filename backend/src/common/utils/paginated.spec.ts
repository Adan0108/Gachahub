import { resolvePagination, toPaginated } from './paginated';

describe('resolvePagination', () => {
  it('defaults to page 1, limit 20', () => {
    expect(resolvePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('computes the row offset from page and limit', () => {
    expect(resolvePagination({ page: 3, limit: 10 })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
    });
  });
});

describe('toPaginated', () => {
  it('wraps items with page metadata', () => {
    expect(toPaginated(['a', 'b'], { page: 2, limit: 2, total: 5 })).toEqual({
      items: ['a', 'b'],
      meta: { page: 2, limit: 2, total: 5, totalPages: 3 },
    });
  });

  it('reports zero pages for an empty result', () => {
    const result = toPaginated([], { page: 1, limit: 20, total: 0 });

    expect(result.meta.totalPages).toBe(0);
  });
});
