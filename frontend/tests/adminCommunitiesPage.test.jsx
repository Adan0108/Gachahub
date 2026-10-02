import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminCommunitiesPage from "../app/admin/communities/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/communities",
}));

vi.mock("../hooks/useRequireAdmin", () => ({
  useRequireAdmin: () => ({
    user: { id: "admin-1", name: "Admin" },
    isAdmin: true,
    isLoading: false,
  }),
}));

const mocks = vi.hoisted(() => ({
  getGames: vi.fn(),
  archiveGame: vi.fn(),
  restoreGame: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    getGames: mocks.getGames,
    archiveGame: mocks.archiveGame,
    restoreGame: mocks.restoreGame,
    createGame: vi.fn(),
    updateGame: vi.fn(),
    uploadSingleImage: vi.fn(),
    updateGameBranding: vi.fn(),
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminCommunitiesPage />
    </QueryClientProvider>,
  );
}

const baseGame = {
  id: "game-1",
  slug: "wuthering-waves",
  name: "Wuthering Waves",
  description: "An open-world action RPG",
  developer: "Kuro Games",
  members: 1200,
  symbol: "W",
  status: "ACTIVE",
};

describe("AdminCommunitiesPage", () => {
  beforeEach(() => {
    mocks.getGames.mockReset();
    mocks.archiveGame.mockReset().mockResolvedValue({});
    mocks.restoreGame.mockReset().mockResolvedValue({});
  });

  it("offers Archive for an active community", async () => {
    mocks.getGames.mockResolvedValue({
      items: [baseGame],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(
      await screen.findByRole("button", { name: /archive wuthering waves/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /restore wuthering waves/i }),
    ).not.toBeInTheDocument();
  });

  it("offers Restore for an archived community and disables Edit", async () => {
    mocks.getGames.mockResolvedValue({
      items: [{ ...baseGame, status: "ARCHIVED" }],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(
      await screen.findByRole("button", { name: /restore wuthering waves/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit wuthering waves/i })).toBeDisabled();
  });

  it("archives a community after confirming the dialog", async () => {
    mocks.getGames.mockResolvedValue({
      items: [baseGame],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /archive wuthering waves/i }));
    fireEvent.click(screen.getByRole("button", { name: /^archive community$/i }));

    expect(await screen.findByText(/community archived/i)).toBeInTheDocument();
    expect(mocks.archiveGame).toHaveBeenCalledWith("wuthering-waves");
  });

  it("shows an empty state when no communities match the filters", async () => {
    mocks.getGames.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
    });
    renderPage();

    expect(await screen.findByText(/no communities found/i)).toBeInTheDocument();
  });
});
