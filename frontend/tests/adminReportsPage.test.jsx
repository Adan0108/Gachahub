import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminReportsPage from "../app/admin/reports/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/reports",
}));

vi.mock("../hooks/useRequireAdmin", () => ({
  useRequireAdmin: () => ({
    user: { id: "admin-1", name: "Admin" },
    isAdmin: true,
    isLoading: false,
  }),
}));

const mocks = vi.hoisted(() => ({
  listReports: vi.fn(),
  claimReport: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    listReports: mocks.listReports,
    claimReport: mocks.claimReport,
    resolveReport: vi.fn(),
    dismissReport: vi.fn(),
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
      <AdminReportsPage />
    </QueryClientProvider>,
  );
}

const pendingReport = {
  id: "report-1",
  gameId: "game-1",
  game: { id: "game-1", name: "Wuthering Waves", slug: "wuthering-waves" },
  targetType: "POST",
  targetId: "post-1",
  reasonCode: "SPAM",
  status: "PENDING",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("AdminReportsPage claim action", () => {
  beforeEach(() => {
    mocks.listReports.mockReset();
    mocks.claimReport.mockReset();
  });

  it("shows a notice and leaves the row PENDING when claiming fails", async () => {
    mocks.listReports.mockResolvedValue({
      items: [pendingReport],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    mocks.claimReport.mockRejectedValue(new Error("This report is no longer pending"));
    renderPage();

    const claimButton = await screen.findByRole("button", { name: /claim report-1/i });
    fireEvent.click(claimButton);

    expect(await screen.findByText("This report is no longer pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /claim report-1/i })).toBeInTheDocument();
  });
});
