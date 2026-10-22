import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldLimit } from "../components/FieldLimit";

describe("FieldLimit", () => {
  it("shows the count and announces the limit through the field description", () => {
    const { rerender } = render(
      <label>
        Content
        <textarea aria-describedby="content-limit" maxLength={30000} />
        <FieldLimit id="content-limit" value="hello" max={30000} />
      </label>,
    );
    expect(screen.getByRole("textbox", { name: "Content" })).toHaveAccessibleDescription(
      "5/30000 characters",
    );
    rerender(
      <label>
        Content
        <textarea aria-describedby="content-limit" maxLength={30000} />
        <FieldLimit id="content-limit" value={"x".repeat(30000)} max={30000} />
      </label>,
    );
    expect(screen.getByRole("textbox", { name: "Content" })).toHaveAccessibleDescription(
      "30000/30000 characters — Limit reached.",
    );
  });

  it("warns for existing values over the limit too", () => {
    render(<FieldLimit id="over-limit" value="abcdef" max={5} />);
    expect(screen.getByText(/Limit reached/)).toHaveClass("field-warning");
  });
});
