import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CreatePostPage from "../app/create/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));

describe("create post limits", () => {
  it("shows the post content count and warns at 30,000", () => {
    render(<CreatePostPage />);
    const content = screen.getByRole("textbox", { name: "Content" });
    expect(content).toHaveAttribute("maxlength", "30000");
    expect(content).toHaveAccessibleDescription("0/30000 characters");
    fireEvent.change(content, { target: { value: "x".repeat(30000) } });
    expect(content).toHaveAccessibleDescription("30000/30000 characters — Limit reached.");
  });

  it("rejects too many or oversized tags immediately and preserves the valid input", () => {
    render(<CreatePostPage />);
    const tags = screen.getByRole("textbox", { name: /^Tags/ });
    fireEvent.change(tags, { target: { value: "x".repeat(80) } });
    expect(tags).toHaveValue("x".repeat(80));
    fireEvent.change(tags, { target: { value: "x".repeat(81) } });
    expect(tags).toHaveValue("x".repeat(80));
    expect(screen.getByText("Each tag must be 80 characters or fewer.")).toBeInTheDocument();
    const ten = Array.from({ length: 10 }, (_, i) => `tag${i}`).join(",");
    fireEvent.change(tags, { target: { value: ten } });
    fireEvent.change(tags, { target: { value: ten + ",extra" } });
    expect(tags).toHaveValue(ten);
    expect(screen.getByText("Use no more than 10 tags.")).toBeInTheDocument();
  });
});
