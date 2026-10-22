"use client";

import { AdminState } from "./AdminState";
import type { ReactNode } from "react";
interface BoundaryProps {
  query?: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => unknown;
  loading?: { title: string; message?: string };
  error?: { title: string; message?: string };
  empty?: { title: string; message?: string } | null;
  children: ReactNode;
}

/**
 * The loading/error/empty ladder every admin list page opens with, extracted
 * so each page only states its own copy and empty condition instead of
 * re-typing the same four branches. Pass `query` for the common single-query
 * case (it supplies isLoading/isError and an onRetry that calls refetch);
 * pass `isLoading`/`isError`/`onRetry` directly for a page like Moderation
 * that combines more than one query into one boundary. Omit `empty` entirely
 * on a page whose data can never legitimately come back empty (e.g. a fixed
 * set of dashboard metrics) - there's then no empty branch to render.
 */
export function AdminQueryBoundary({
  query,
  isLoading,
  isError,
  onRetry,
  loading,
  error,
  empty,
  children,
}: BoundaryProps) {
  const stillLoading = query ? query.isLoading : isLoading;
  const failed = query ? query.isError : isError;
  const retry = query ? () => query.refetch() : onRetry;

  if (stillLoading) return <AdminState kind="loading" title="Loading" {...loading} />;
  if (failed)
    return <AdminState kind="error" title="Could not load data" {...error} onRetry={retry} />;
  if (empty) return <AdminState kind="empty" {...empty} />;
  return children;
}
