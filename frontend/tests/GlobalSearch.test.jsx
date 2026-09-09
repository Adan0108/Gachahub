import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "../components/GlobalSearch";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  useQuery: vi.fn(() => ({ data: { items: [] }, isLoading: false, isError: false })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("../lib/api", () => ({
  api: { usingMocks: false },
  fallbackGames: () => ({ items: [] }),
  fallbackPosts: () => [],
}));
vi.mock("../lib/queries", () => ({
  queries: { games: (search) => ({ queryKey: ["games", search] }) },
}));

describe("GlobalSearch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits 350ms before enabling search and does not nag on short input", () => {
    render(<GlobalSearch />);
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "a" } });

    expect(screen.queryByText(/enter at least/i)).not.toBeInTheDocument();
    expect(mocks.useQuery.mock.calls.at(-1)[0].enabled).toBe(false);

    fireEvent.change(input, { target: { value: "ab" } });
    expect(mocks.useQuery.mock.calls.at(-1)[0].enabled).toBe(false);

    act(() => vi.advanceTimersByTime(350));
    expect(mocks.useQuery.mock.calls.at(-1)[0].enabled).toBe(true);
    expect(screen.getByText(/no matches found/i)).toBeInTheDocument();
  });
});
