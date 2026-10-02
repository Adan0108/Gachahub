/** Page/limit from a pagination query, with the platform defaults and the row offset. */
export function resolvePagination(query: { page?: number; limit?: number }) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  return { page, limit, skip: (page - 1) * limit };
}

/** Wraps a page of rows in the standard `{ items, meta }` list envelope. */
export function toPaginated<T>(
  items: T[],
  params: { page: number; limit: number; total: number },
) {
  const { page, limit, total } = params;

  return {
    items,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
