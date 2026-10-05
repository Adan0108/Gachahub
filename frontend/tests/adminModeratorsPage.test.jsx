import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminModeratorsPage from "../app/admin/moderators/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/moderators",
}));

vi.mock("../hooks/admin/useRequireAdmin", () => ({
  useRequireAdmin: () => ({
    user: { id: "admin-1", name: "Admin" },
    isAdmin: true,
    isLoading: false,
  }),
}));

const mocks = vi.hoisted(() => ({
  getGames: vi.fn(),
  getGameModerators: vi.fn(),
  assignGameModerator: vi.fn(),
  removeGameModerator: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    getGames: mocks.getGames,
    getGameModerators: mocks.getGameModerators,
    assignGameModerator: mocks.assignGameModerator,
    removeGameModerator: mocks.removeGameModerator,
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
      <AdminModeratorsPage />
    </QueryClientProvider>,
  );
}

const games = [
  { id: "game-1", slug: "wuthering-waves", name: "Wuthering Waves" },
  { id: "game-2", slug: "genshin-impact", name: "Genshin Impact" },
];

const assignment = {
  id: "assignment-1",
  user: { id: "user-1", name: "Rover", email: "rover@example.com", status: "ACTIVE" },
  assigner: { name: "Admin" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("AdminModeratorsPage", () => {
  beforeEach(() => {
    mocks.getGames.mockReset().mockResolvedValue({
      items: games,
      meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });
    mocks.getGameModerators.mockReset();
    mocks.assignGameModerator.mockReset().mockResolvedValue({});
    mocks.removeGameModerator.mockReset().mockResolvedValue({});
  });

  it("lists moderators assigned to the first community by default", async () => {
    mocks.getGameModerators.mockResolvedValue([assignment]);
    renderPage();

    expect(await screen.findByText("Rover")).toBeInTheDocument();
    expect(mocks.getGameModerators).toHaveBeenCalledWith(
      "wuthering-waves",
      expect.anything(),
    );
  });

  it("shows an empty state when the selected community has no moderators", async () => {
    mocks.getGameModerators.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no moderators assigned/i)).toBeInTheDocument();
  });

  it("refetches scoped moderators when the community selector changes", async () => {
    mocks.getGameModerators.mockResolvedValue([assignment]);
    renderPage();

    await screen.findByText("Rover");
    fireEvent.change(screen.getByLabelText(/community scope/i), {
      target: { value: "genshin-impact" },
    });

    expect(await screen.findByText("Rover")).toBeInTheDocument();
    expect(mocks.getGameModerators).toHaveBeenLastCalledWith(
      "genshin-impact",
      expect.anything(),
    );
  });

  it("removes a moderator after confirming the dialog", async () => {
    mocks.getGameModerators.mockResolvedValue([assignment]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /remove rover/i }));
    fireEvent.click(screen.getByRole("button", { name: /^remove access$/i }));

    expect(await screen.findByText(/moderator removed/i)).toBeInTheDocument();
    expect(mocks.removeGameModerator).toHaveBeenCalledWith("wuthering-waves", "user-1");
  });
});
