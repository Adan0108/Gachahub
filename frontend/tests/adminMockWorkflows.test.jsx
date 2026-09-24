import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminActionDialog } from "../components/admin/AdminActionDialog";
import { api } from "../lib/api";

describe("mock-backed admin workflows", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns documented list and mutation shapes without backend requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const [users, content, reports] = await Promise.all([
      api.listAdminUsers(),
      api.listAdminContent(),
      api.listReports(),
    ]);
    const hidden = await api.hideComment("comment-1", { reason: "Spam" });
    const banned = await api.banUser("user-1", { reason: "Abuse", durationDays: 30 });

    expect(users).toEqual(
      expect.objectContaining({ items: expect.any(Array), meta: expect.any(Object) }),
    );
    expect(content).toEqual(
      expect.objectContaining({ items: expect.any(Array), meta: expect.any(Object) }),
    );
    expect(reports).toEqual(
      expect.objectContaining({ items: expect.any(Array), meta: expect.any(Object) }),
    );
    expect(hidden).toMatchObject({ id: "comment-1", status: "HIDDEN", reason: "Spam" });
    expect(banned).toMatchObject({ id: "user-1", status: "BANNED", durationDays: 30 });
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
