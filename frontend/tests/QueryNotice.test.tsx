import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryNotice } from "../components/QueryNotice";

describe("QueryNotice", () => {
  it("announces loading and empty states", () => {
    const { rerender } = render(<QueryNotice isLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading fresh data...");

    rerender(<QueryNotice isEmpty emptyText="Nothing here yet." />);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing here yet.");
  });

  it("shows an honest error and retries the query", () => {
    const retry = vi.fn();
    render(<QueryNotice isError onRetry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load this right now.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
