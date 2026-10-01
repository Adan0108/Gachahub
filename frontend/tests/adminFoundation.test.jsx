import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminState } from "../components/admin/AdminState";
import { api } from "../lib/api";

describe("admin foundation", () => {
  it("renders loading and empty states", () => {
    const { rerender } = render(
      <AdminState kind="loading" title="Loading dashboard" message="Gathering activity." />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard");

    rerender(<AdminState kind="empty" title="No dashboard data" />);
    expect(screen.getByRole("status")).toHaveTextContent("No dashboard data");
  });

  it("offers a retry action for errors", () => {
    const onRetry = vi.fn();
    render(<AdminState kind="error" title="Dashboard unavailable" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("exposes a stable mock contract for the unsupported overview endpoint", async () => {
    const overview = await api.getAdminOverview();

    expect(overview).toEqual(
      expect.objectContaining({ metrics: expect.any(Array), communities: expect.any(Array) }),
    );
  });
});
