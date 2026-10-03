import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvatarFace } from "../components/AvatarFace";

describe("AvatarFace", () => {
  it("shows the picture when there is one", () => {
    const { container } = render(<AvatarFace image="https://cdn/a.png" name="Rover" />);

    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn/a.png");
    expect(screen.queryByText("R")).not.toBeInTheDocument();
  });

  it("falls back to the initial without a picture", () => {
    render(<AvatarFace image={null} name="rover" />);

    expect(screen.getByText("R")).toBeInTheDocument();
  });

  it("uses a custom fallback instead of the initial", () => {
    render(<AvatarFace fallback="AB" image={null} name="Rover" />);

    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("falls back when the picture fails to load", () => {
    const { container } = render(<AvatarFace image="https://cdn/broken.png" name="Rover" />);

    fireEvent.error(container.querySelector("img"));

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("R")).toBeInTheDocument();
  });

  it("tries a new picture again after a previous one failed", () => {
    const { container, rerender } = render(<AvatarFace image="https://cdn/broken.png" name="Rover" />);
    fireEvent.error(container.querySelector("img"));

    rerender(<AvatarFace image="https://cdn/fresh.png" name="Rover" />);

    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn/fresh.png");
  });
});
