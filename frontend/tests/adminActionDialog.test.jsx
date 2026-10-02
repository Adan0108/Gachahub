import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminActionDialog } from "../components/admin/AdminActionDialog";

describe("AdminActionDialog", () => {
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
