"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { useRequireAdmin } from "./useRequireAdmin";

/**
 * Shared state wiring for an admin list page: session gate, filters + page (page resets to 1
 * whenever a filter changes), the list query, and an invalidate() scoped to the query prefix.
 * `queryFactory(filters, page)` must return a `queries.adminX(...)`-shaped object.
 *
 * The query runs against a deferred copy of filters, not the live one - a free-text filter
 * (search) doesn't fire a request per keystroke, while the raw `filters` stays available for
 * controlled inputs so typing itself never lags.
 */
export function useAdminList(queryFactory, { prefix }) {
  const session = useRequireAdmin();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const deferredFilters = useDeferredValue(filters);
  const { enabled: factoryEnabled = true, ...factory } = queryFactory(deferredFilters, page);
  const query = useQuery({
    ...factory,
    enabled: session.isAdmin && factoryEnabled,
  });

  return {
    session,
    page,
    setPage,
    filters,
    setFilter: (key, value) => {
      setFilters((current) => ({ ...current, [key]: value }));
      setPage(1);
    },
    items: query.data?.items || [],
    meta: query.data?.meta,
    invalidate: () => queryClient.invalidateQueries({ queryKey: prefix }),
    query,
  };
}
