export interface Page<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | undefined;
}

/** Reads a list response that is a bare array (no paging) or an object with `items` (or the legacy `key` field) plus optional hasMore/nextCursor. */
export function readPage<T>(response: unknown, key: string, fullPageSize?: number): Page<T> {
  if (Array.isArray(response)) {
    // The server caps a bare-array page, so a full one means there may be more.
    const hasMore = fullPageSize !== undefined && response.length >= fullPageSize;
    // The server pages by the last item's id, so a full bare-array page carries its own cursor.
    const lastId = (response.at(-1) as { id?: unknown } | undefined)?.id;
    return {
      items: response as T[],
      hasMore,
      nextCursor: hasMore && typeof lastId === 'string' ? lastId : undefined,
    };
  }

  const body = (response ?? {}) as Record<string, unknown>;
  const list = body.items ?? body[key];
  return {
    items: Array.isArray(list) ? (list as T[]) : [],
    hasMore: body.hasMore === true,
    nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : undefined,
  };
}
