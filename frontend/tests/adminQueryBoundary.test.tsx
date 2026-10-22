import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminQueryBoundary } from "../components/admin/AdminQueryBoundary";

describe("AdminQueryBoundary", () => {
  it("renders the loading state from a query object", () => {
    const query = { isLoading: true, isError: false, refetch: vi.fn() };
    render(
      <AdminQueryBoundary query={query} loading={{ title: "Loading things" }}>
        <p>content</p>
      </AdminQueryBoundary>,
    );

    expect(screen.getByText("Loading things")).toBeInTheDocument();
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("renders the error state and retries via the query's own refetch", () => {
    const refetch = vi.fn();
    const query = { isLoading: false, isError: true, refetch };
    render(
      <AdminQueryBoundary query={query} error={{ title: "Broke" }}>
        <p>content</p>
      </AdminQueryBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("renders the empty state only when `empty` is truthy", () => {
    const query = { isLoading: false, isError: false, refetch: vi.fn() };
    render(
      <AdminQueryBoundary query={query} empty={{ title: "Nothing here" }}>
        <p>content</p>
      </AdminQueryBoundary>,
    );

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("renders children when not loading, not errored, and empty is falsy", () => {
    const query = { isLoading: false, isError: false, refetch: vi.fn() };
    render(
      <AdminQueryBoundary query={query} empty={null}>
        <p>content</p>
      </AdminQueryBoundary>,
    );

    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("renders children when `empty` is omitted entirely, for data that can never legitimately be empty", () => {
    const query = { isLoading: false, isError: false, refetch: vi.fn() };
    render(
      <AdminQueryBoundary query={query}>
        <p>content</p>
      </AdminQueryBoundary>,
    );

    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("accepts explicit isLoading/isError/onRetry instead of a query object, for pages that combine more than one query", () => {
    const onRetry = vi.fn();
    render(
      <AdminQueryBoundary isLoading={false} isError onRetry={onRetry} error={{ title: "Broke" }}>
        <p>content</p>
      </AdminQueryBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
