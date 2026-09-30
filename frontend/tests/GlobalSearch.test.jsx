import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "../components/GlobalSearch";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  useQuery: vi.fn((options) => ({
    data:
      options.queryKey?.[0] === "posts"
        ? {
            items: [
              {
                id: "post-1",
                title: "Rover build guide",
                gameName: "Wuthering Waves",
                author: "RoverTide",
              },
            ],
          }
        : { items: [] },
    isLoading: false,
    isFetching: false,
    isError: false,
  })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("../lib/api", () => ({
  api: { usingMocks: false },
  fallbackGames: () => ({ items: [] }),
  fallbackPosts: () => [],
}));
vi.mock("../lib/queries", () => ({
  queries: {
    games: (search) => ({ queryKey: ["games", search] }),
    posts: (search) => ({ queryKey: ["posts", search] }),
  },
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
    expect(mocks.useQuery.mock.calls.slice(-2).every(([options]) => !options.enabled)).toBe(true);

    fireEvent.change(input, { target: { value: "ab" } });
    expect(mocks.useQuery.mock.calls.slice(-2).every(([options]) => !options.enabled)).toBe(true);
    expect(screen.getByRole("status", { name: /searching/i })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(350));
    expect(mocks.useQuery.mock.calls.slice(-2).every(([options]) => options.enabled)).toBe(true);
    expect(screen.queryByRole("status", { name: /searching/i })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Posts" })).toBeInTheDocument();
  });

  it("opens a selected post directly", () => {
    mocks.push.mockClear();
    render(<GlobalSearch />);
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "rover" } });
    act(() => vi.advanceTimersByTime(350));
    fireEvent.click(screen.getByRole("option", { name: /rover build guide/i }));

    expect(mocks.push).toHaveBeenCalledWith("/post/post-1");
  });
});
