import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModeratorPage from "../app/moderator/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

const mocks = vi.hoisted(() => ({
  flagGameForReview: vi.fn(),
  refetchGames: vi.fn(),
}));

let moderatorSession;

vi.mock("../hooks/admin/useRequireModerator", () => ({
  useRequireModerator: () => moderatorSession,
}));

vi.mock("../lib/api", () => ({
  api: {
    flagGameForReview: mocks.flagGameForReview,
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
      <ModeratorPage />
    </QueryClientProvider>,
  );
}

const activeGame = {
  id: "game-1",
  slug: "wuthering-waves",
  name: "Wuthering Waves",
  status: "ACTIVE",
  iconUrl: null,
  bannerUrl: null,
};

describe("ModeratorPage", () => {
  beforeEach(() => {
    mocks.flagGameForReview.mockReset().mockResolvedValue({});
    mocks.refetchGames.mockReset();
    moderatorSession = {
      user: { id: "mod-1", name: "Moderator" },
      isAuthenticated: true,
      isLoading: false,
      hasAccess: true,
      games: [activeGame],
      gamesError: false,
      refetchGames: mocks.refetchGames,
    };
  });

  it("shows an empty state when the moderator has no assigned games", () => {
    moderatorSession.games = [];
    renderPage();

    expect(screen.getByText(/no games assigned/i)).toBeInTheDocument();
  });

  it("lets a moderator upload branding for an active game", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Wuthering Waves" })).toBeInTheDocument();
    expect(screen.getByText("Icon")).toBeInTheDocument();
    expect(screen.getByText("Banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /flag for review/i })).toBeInTheDocument();
  });

  it("hides branding uploads and flagging for an archived game", () => {
    moderatorSession.games = [{ ...activeGame, status: "ARCHIVED" }];
    renderPage();

    expect(screen.getByText(/branding and flagging are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText("Icon")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /flag for review/i })).not.toBeInTheDocument();
  });

  it("submits a flag with the entered reason", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /flag for review/i }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByPlaceholderText(/what should the admin look at/i), {
      target: { value: "Suspicious banner" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /flag for review/i }));

    expect(await screen.findByText(/flagged for admin review/i)).toBeInTheDocument();
    expect(mocks.flagGameForReview).toHaveBeenCalledWith("wuthering-waves", "Suspicious banner");
  });
});
