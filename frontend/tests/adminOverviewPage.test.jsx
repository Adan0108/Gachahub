import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "../app/admin/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
}));

vi.mock("../hooks/useRequireAdmin", () => ({
  useRequireAdmin: () => ({
    user: { id: "admin-1", name: "Admin" },
    isAdmin: true,
    isLoading: false,
  }),
}));

const mocks = vi.hoisted(() => ({
  getAdminOverview: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: { getAdminOverview: mocks.getAdminOverview },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminPage />
    </QueryClientProvider>,
  );
}

describe("AdminPage overview", () => {
  beforeEach(() => {
    mocks.getAdminOverview.mockReset();
  });

  it("renders real counts with the frontend's own label, no fabricated trend percentage", async () => {
    mocks.getAdminOverview.mockResolvedValue({
      metrics: [{ id: "members", value: 150000 }],
      communities: [],
      activity: [],
    });
    renderPage();

    expect(await screen.findByText("Total members")).toBeInTheDocument();
    expect(screen.getByText("150K")).toBeInTheDocument();
    expect(screen.queryByText(/% this month/i)).not.toBeInTheDocument();
  });

  it("maps the raw action enum to a human label and builds the subject from resolved target data", async () => {
    mocks.getAdminOverview.mockResolvedValue({
      metrics: [{ id: "members", value: 1 }],
      communities: [],
      activity: [
        {
          id: "log-1",
          actorName: "Mod One",
          action: "POST_HIDDEN",
          targetType: "POST",
          targetId: "post-1",
          targetName: "Version guide",
          occurredAt: new Date().toISOString(),
        },
      ],
    });
    renderPage();

    expect(await screen.findByText("Post hidden")).toBeInTheDocument();
    expect(screen.getByText("Just now")).toBeInTheDocument();
    expect(screen.getByText(/Post: Version guide/)).toBeInTheDocument();
    expect(screen.getByText(/by Mod One/)).toBeInTheDocument();
  });

  it("falls back to the raw target id when the backend has no resolved target name", async () => {
    mocks.getAdminOverview.mockResolvedValue({
      metrics: [{ id: "members", value: 1 }],
      communities: [],
      activity: [
        {
          id: "log-1",
          actorName: "Mod One",
          action: "USER_BANNED",
          targetType: "USER",
          targetId: "user-2",
          targetName: null,
          occurredAt: new Date().toISOString(),
        },
      ],
    });
    renderPage();

    expect(await screen.findByText("User banned")).toBeInTheDocument();
    expect(screen.getByText(/User user-2/)).toBeInTheDocument();
  });

  it("shows an empty state instead of a blank list when there is no recent activity", async () => {
    mocks.getAdminOverview.mockResolvedValue({
      metrics: [{ id: "members", value: 1 }],
      communities: [],
      activity: [],
    });
    renderPage();

    expect(await screen.findByText("No recent activity")).toBeInTheDocument();
  });

  it("shows an empty state instead of a headers-only table when there are no active communities", async () => {
    mocks.getAdminOverview.mockResolvedValue({
      metrics: [{ id: "members", value: 1 }],
      communities: [],
      activity: [],
    });
    renderPage();

    expect(await screen.findByText("No active communities")).toBeInTheDocument();
  });

  it("drops the Status column now every row is always ACTIVE", async () => {
    mocks.getAdminOverview.mockResolvedValue({
      metrics: [{ id: "members", value: 1 }],
      communities: [{ id: "game-1", name: "Genshin Impact", members: 500, reports: 2 }],
      activity: [],
    });
    renderPage();

    expect(await screen.findByText("Genshin Impact")).toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });
});
