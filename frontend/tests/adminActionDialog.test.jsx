import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminActionDialog } from "../components/admin/AdminActionDialog";

describe("AdminActionDialog", () => {
  it("focuses the note, traps keyboard focus and restores the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const close = vi.fn();
    const view = render(<AdminActionDialog title="Resolve case" description="Decision" confirmLabel="Confirm" onClose={close} onConfirm={() => {}}><textarea aria-label="Note" /></AdminActionDialog>);
    expect(screen.getByLabelText("Note")).toHaveFocus();
    screen.getByRole("button", { name: "Confirm" }).focus();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
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
