import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminActionDialog } from "../components/admin/AdminActionDialog";
import { api } from "../lib/api";

describe("mock-backed admin workflows", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the documented overview shape without backend requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const overview = await api.getAdminOverview();

    expect(overview).toEqual(
      expect.objectContaining({ metrics: expect.any(Array), communities: expect.any(Array) }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps destructive confirmation disabled until required input is present", () => {
    const { rerender } = render(
      <AdminActionDialog
        confirmDisabled
        confirmLabel="Hide content"
        description="Confirm action"
        onClose={() => {}}
        onConfirm={() => {}}
        pending={false}
        pendingLabel="Hiding..."
        title="Hide content?"
      />,
    );
    expect(screen.getByRole("button", { name: "Hide content" })).toBeDisabled();

    rerender(
      <AdminActionDialog
        confirmDisabled={false}
        confirmLabel="Hide content"
        description="Confirm action"
        onClose={() => {}}
        onConfirm={() => {}}
        pending={false}
        pendingLabel="Hiding..."
        title="Hide content?"
      />,
    );
    expect(screen.getByRole("button", { name: "Hide content" })).toBeEnabled();
  });
});
