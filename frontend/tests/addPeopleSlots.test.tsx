import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddPeopleDialog } from "../components/chat/AddPeopleDialog";

vi.mock("../hooks/chat/useUserSearch", () => ({
  USER_SEARCH_MIN_CHARS: 2,
  useUserSearch: () => ({ items: [], isLoading: false, isActive: false, retry: vi.fn() }),
}));

const people = ["a", "b", "c"].map((id) => ({ id, name: `Person ${id}`, username: id, image: null }));

describe("AddPeopleDialog room", () => {
  it("stops offering more people once the free slots are used, and frees them when one is unticked", () => {
    render(<AddPeopleDialog onAdd={vi.fn()} onClose={vi.fn()} slots={2} suggested={people} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Person a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Person b" }));

    expect(screen.getByText("0 people left")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Person c" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Person a" })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Person a" }));

    expect(screen.getByText("1 person left")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Person c" })).toBeEnabled();
  });
});
