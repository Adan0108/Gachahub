import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserPicker } from "../components/chat/UserPicker";

vi.mock("../hooks/chat/useUserSearch", () => ({
  USER_SEARCH_MIN_CHARS: 2,
  useUserSearch: () => ({
    items: [{ id: "u1", name: "Rover", image: null, username: "rover" }],
    isActive: true,
    isLoading: false,
    error: undefined,
    retry: () => {},
  }),
}));

describe("UserPicker handle", () => {
  it("keeps the picked user's username so the chip can show their @handle", () => {
    const onChange = vi.fn();
    render(<UserPicker onChange={onChange} value={[]} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ro" } });
    fireEvent.click(screen.getByRole("option", { name: /Rover/ }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "u1", username: "rover" }),
    ]);
  });
});
