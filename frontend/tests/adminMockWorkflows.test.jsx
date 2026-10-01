import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminActionDialog } from "../components/admin/AdminActionDialog";
import { api } from "../lib/api";

describe("mock-backed admin workflows", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns documented list shapes without backend requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const content = await api.listAdminContent();

    expect(content).toEqual(
      expect.objectContaining({ items: expect.any(Array), meta: expect.any(Object) }),
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
