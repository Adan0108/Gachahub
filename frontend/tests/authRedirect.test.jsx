import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import CreatePostPage from "../app/create/page";

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ isAuthenticated: false, isLoading: false }),
}));
vi.mock("../lib/api", () => ({
  api: {
    getGames: vi.fn(() => Promise.resolve({ items: [] })),
    getCategories: vi.fn(() => Promise.resolve([])),
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

describe("authenticated routes", () => {
  it("redirects unauthenticated post authors to login", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CreatePostPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });
});
