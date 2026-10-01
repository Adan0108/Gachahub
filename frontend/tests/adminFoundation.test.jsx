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

  it("exposes stable mock contracts for unsupported admin endpoints", async () => {
    const overview = await api.getAdminOverview();
    const reports = await api.listReports();
    const resolution = await api.resolveReport("report-1", {
      resolution: "NO_VIOLATION",
      note: "Reviewed",
    });
    const ban = await api.banUser("user-1", { reason: "Repeated abuse", durationDays: 7 });

    expect(overview).toEqual(
      expect.objectContaining({ metrics: expect.any(Array), communities: expect.any(Array) }),
    );
    expect(reports).toEqual(
      expect.objectContaining({ items: expect.any(Array), meta: expect.any(Object) }),
    );
    expect(resolution).toMatchObject({ id: "report-1", status: "RESOLVED" });
    expect(ban).toMatchObject({ id: "user-1", status: "BANNED", durationDays: 7 });
  });
});
