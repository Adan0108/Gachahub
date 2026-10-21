import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminModeratorsPage from "../app/admin/moderators/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/moderators",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../hooks/admin/useRequireAdmin", () => ({
  useRequireAdmin: () => ({
    user: { id: "admin-1", name: "Admin" },
    isAdmin: true,
    isLoading: false,
  }),
}));

const mocks = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  getGames: vi.fn(),
  getGameModerators: vi.fn(),
  assignGameModerator: vi.fn(),
  searchGameModeratorCandidates: vi.fn(),
  removeGameModerator: vi.fn(),
  searchPlatformModeratorCandidates: vi.fn(),
  grantPlatformModerator: vi.fn(),
  revokePlatformModerator: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    listAdminUsers: mocks.listAdminUsers,
    getGames: mocks.getGames,
    getGameModerators: mocks.getGameModerators,
    assignGameModerator: mocks.assignGameModerator,
    searchGameModeratorCandidates: mocks.searchGameModeratorCandidates,
    removeGameModerator: mocks.removeGameModerator,
    searchPlatformModeratorCandidates: mocks.searchPlatformModeratorCandidates,
    grantPlatformModerator: mocks.grantPlatformModerator,
    revokePlatformModerator: mocks.revokePlatformModerator,
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
    mocks.listAdminUsers
      .mockReset()
      .mockResolvedValue({ items: [], meta: { page: 1, totalPages: 1, total: 0 } });
    mocks.getGames.mockReset().mockResolvedValue({
      items: games,
      meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });
    mocks.getGameModerators.mockReset();
    mocks.assignGameModerator.mockReset().mockResolvedValue({});
    mocks.searchGameModeratorCandidates.mockReset().mockResolvedValue({
      items: [{ id: "candidate", name: "Radium", username: "radium", role: "USER" }],
    });
    mocks.removeGameModerator.mockReset().mockResolvedValue({});
    mocks.searchPlatformModeratorCandidates.mockReset().mockResolvedValue({
      items: [
        { id: "platform-target", name: "Review Rover", username: "review-rover", role: "USER" },
      ],
    });
    mocks.grantPlatformModerator.mockReset().mockResolvedValue({});
    mocks.revokePlatformModerator.mockReset().mockResolvedValue({});
  });

  it.each(["USER", "PLATFORM_MODERATOR"])(
    "requires confirmation before changing %s platform access",
    async (role) => {
      mocks.getGameModerators.mockResolvedValue([]);
      mocks.searchPlatformModeratorCandidates.mockResolvedValue({
        items: [{ id: "platform-target", name: "Review Rover", username: "review-rover", role }],
      });
      renderPage();
      fireEvent.change(screen.getByRole("searchbox", { name: "Find user or platform moderator" }), {
        target: { value: "@review-rover" },
      });
      fireEvent.click(
        await screen.findByRole("button", { name: "Select Review Rover (@review-rover)" }),
      );
      const revoke = role === "PLATFORM_MODERATOR";
      fireEvent.click(
        screen.getByRole("button", {
          name: revoke ? "Remove platform moderator access" : "Grant platform moderator access",
        }),
      );
      expect(mocks.grantPlatformModerator).not.toHaveBeenCalled();
      expect(mocks.revokePlatformModerator).not.toHaveBeenCalled();
      expect(screen.getByRole("alertdialog")).toBeVisible();
      if (revoke)
        expect(
          screen.getByText(/Normal user access and any game moderator assignments remain/),
        ).toBeVisible();
      fireEvent.click(
        screen.getByRole("button", {
          name: revoke ? "Remove platform access" : "Grant platform access",
        }),
      );
      await waitFor(() =>
        expect(
          revoke ? mocks.revokePlatformModerator : mocks.grantPlatformModerator,
        ).toHaveBeenCalledWith("platform-target"),
      );
      expect(
        await screen.findByText(
          revoke
            ? "Platform moderator access removed. Normal user access remains."
            : "Platform moderator access granted.",
        ),
      ).toBeVisible();
    },
  );

  it("loads a bounded persistent platform moderator list with identity, role and remove confirmation", async () => {
    mocks.getGameModerators.mockResolvedValue([]);
    mocks.listAdminUsers.mockResolvedValue({
      items: [
        {
          id: "listed",
          name: "Listed Moderator",
          username: "listed",
          role: "PLATFORM_MODERATOR",
          status: "ACTIVE",
        },
      ],
      meta: { totalPages: 2, page: 1, total: 21 },
    });
    renderPage();
    expect(await screen.findByText("@listed")).toBeVisible();
    expect(mocks.listAdminUsers).toHaveBeenCalledWith(
      { role: "PLATFORM_MODERATOR", page: 1, limit: 20 },
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Remove platform moderator access?");
    expect(mocks.revokePlatformModerator).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove platform access" }));
    await waitFor(() => expect(mocks.revokePlatformModerator).toHaveBeenCalledWith("listed"));
  });

  it("keeps a failed privilege confirmation open and allows cancellation without a change", async () => {
    mocks.getGameModerators.mockResolvedValue([]);
    mocks.grantPlatformModerator.mockRejectedValue(new Error("User access changed; search again"));
    renderPage();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find user or platform moderator" }), {
      target: { value: "Review Rover" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Select Review Rover (@review-rover)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Grant platform moderator access" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.grantPlatformModerator).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Grant platform moderator access" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant platform access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });

  it("lists moderators assigned to the first community by default", async () => {
    mocks.getGameModerators.mockResolvedValue([assignment]);
    renderPage();

    expect(await screen.findByText("Rover")).toBeInTheDocument();
    expect(mocks.getGameModerators).toHaveBeenCalledWith("wuthering-waves", expect.anything());
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
    expect(mocks.getGameModerators).toHaveBeenLastCalledWith("genshin-impact", expect.anything());
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

it("searches community moderator candidates by identity instead of requesting a database ID", async () => {
  mocks.getGameModerators.mockResolvedValue([]);
  renderPage();
  const open = await screen.findByRole("button", { name: /Assign moderator/ });
  await waitFor(() => expect(open).toBeEnabled());
  fireEvent.click(open);
  fireEvent.change(screen.getByRole("searchbox", { name: "Find moderator" }), {
    target: { value: "@radium" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Select Radium (@radium)" }));
  fireEvent.click(screen.getAllByRole("button", { name: /^Assign moderator$/ }).at(-1));
  expect(await screen.findByText("Moderator assigned")).toBeVisible();
  expect(mocks.assignGameModerator).toHaveBeenCalledWith("wuthering-waves", {
    userId: "candidate",
  });
  expect(screen.queryByLabelText("User ID")).not.toBeInTheDocument();
});
