"use client";

import { useQuery } from "@tanstack/react-query";
import { queries } from "../lib/queries";

export function useCurrentUser({ enabled = true } = {}) {
  const query = useQuery({ ...queries.currentUser(), enabled });

  return {
    user: query.data ?? null,
    isAuthenticated: Boolean(query.data),
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
