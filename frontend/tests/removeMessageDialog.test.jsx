import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoveMessageDialog } from "../components/chat/RemoveMessageDialog";

function setup(target = { id: "m1", mine: true }) {
  const handlers = { onConfirm: vi.fn(), onClose: vi.fn() };
  const view = render(<RemoveMessageDialog target={target} {...handlers} />);
  return { ...handlers, ...view };
}

describe("RemoveMessageDialog", () => {
  it("renders nothing while there is no message to remove", () => {
    const { container } = setup(null);

    expect(container).toBeEmptyDOMElement();
  });

  describe("for your own message", () => {
    it("offers removing it for everyone or hiding it on this device, with everyone chosen", () => {
      setup();

      expect(screen.getByRole("dialog", { name: "Remove this message?" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Remove for everyone/ })).toBeChecked();
      expect(screen.getByRole("radio", { name: /Hide on this device/ })).not.toBeChecked();
      expect(screen.getByText(/deleted for every member of this chat/)).toBeInTheDocument();
      expect(screen.getByText(/This can't be undone/)).toBeInTheDocument();
      expect(screen.getByText(/Everyone else still sees it/)).toBeInTheDocument();
      expect(screen.getByText(/you can undo this right after/)).toBeInTheDocument();
    });

    it("focuses the first choice so the keyboard can start straight away", () => {
      setup();

      expect(screen.getByRole("radio", { name: /Remove for everyone/ })).toHaveFocus();
    });

    it("removes for everyone by default, and the button says Remove", () => {
      const { onConfirm } = setup();

      fireEvent.click(screen.getByRole("button", { name: "Remove" }));

      expect(onConfirm).toHaveBeenCalledWith("everyone");
    });

    it("hides on this device when that is chosen, and the button says Hide", () => {
      const { onConfirm } = setup();

      fireEvent.click(screen.getByRole("radio", { name: /Hide on this device/ }));
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Hide" }));

      expect(onConfirm).toHaveBeenCalledWith("me");
    });

    it("starts on everyone again for the next message", () => {
      const { rerender, onConfirm, onClose } = setup();
      fireEvent.click(screen.getByRole("radio", { name: /Hide on this device/ }));

      rerender(<RemoveMessageDialog onClose={onClose} onConfirm={onConfirm} target={{ id: "m2", mine: true }} />);

      expect(screen.getByRole("radio", { name: /Remove for everyone/ })).toBeChecked();
    });
  });

  describe("for a message from someone else", () => {
    it("only offers to hide it on this device", () => {
      setup({ id: "m1", mine: false });

      expect(screen.getByRole("dialog", { name: "Hide this message?" })).toBeInTheDocument();
      expect(screen.getAllByRole("radio")).toHaveLength(1);
      expect(screen.getByRole("radio", { name: /Hide on this device/ })).toBeChecked();
      expect(screen.queryByText(/Remove for everyone/)).not.toBeInTheDocument();
    });

    it("hides it, with a Hide button", () => {
      const { onConfirm } = setup({ id: "m1", mine: false });

      fireEvent.click(screen.getByRole("button", { name: "Hide" }));

      expect(onConfirm).toHaveBeenCalledWith("me");
    });
  });

  describe("closing", () => {
    it("closes on Cancel, the X and Escape without removing anything", () => {
      const { onConfirm, onClose } = setup();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      fireEvent.keyDown(window, { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(3);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("closes when the dark backdrop is clicked, but not when the dialog itself is", () => {
      const { onClose } = setup();

      fireEvent.click(screen.getByRole("dialog"));
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("dialog").parentElement);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
