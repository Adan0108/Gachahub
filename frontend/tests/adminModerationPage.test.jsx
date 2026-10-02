import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminModerationPage from "../app/admin/moderation/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/moderation",
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
  listAdminContent: vi.fn(),
  getAdminOverview: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    listReports: mocks.listReports,
    listAdminContent: mocks.listAdminContent,
    getAdminOverview: mocks.getAdminOverview,
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
      <AdminModerationPage />
    </QueryClientProvider>,
  );
}

const report = {
  id: "report-1",
  reasonCode: "SPAM",
  targetType: "POST",
  targetId: "post-1",
  status: "PENDING",
};

const flaggedItem = {
  id: "post-1",
  type: "POST",
  title: "Suspicious post",
  authorName: "Rover",
  reportCount: 3,
};

describe("AdminModerationPage", () => {
  beforeEach(() => {
    mocks.listReports.mockReset();
    mocks.listAdminContent.mockReset();
    mocks.getAdminOverview.mockReset();
  });

  it("shows the overview's authoritative open-report count instead of the page's own list length", async () => {
    mocks.listReports.mockResolvedValue({
      items: [report],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    mocks.listAdminContent.mockResolvedValue({
      items: [flaggedItem],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    mocks.getAdminOverview.mockResolvedValue({ metrics: [{ id: "reports", value: 42 }] });
    renderPage();

    expect(await screen.findByText("42")).toBeInTheDocument();
  });

  it("asks the server to exclude hidden content instead of filtering client-side", async () => {
    mocks.listReports.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
    });
    mocks.listAdminContent.mockResolvedValue({
      items: [flaggedItem],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    mocks.getAdminOverview.mockResolvedValue({ metrics: [{ id: "reports", value: 0 }] });
    renderPage();

    await screen.findByText("Suspicious post");
    expect(mocks.listAdminContent).toHaveBeenCalledWith(
      expect.objectContaining({ excludeHidden: true }),
      expect.anything(),
    );
  });

  it("shows an empty state when both queues are clear", async () => {
    mocks.listReports.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
    });
    mocks.listAdminContent.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
    });
    mocks.getAdminOverview.mockResolvedValue({ metrics: [{ id: "reports", value: 0 }] });
    renderPage();

    expect(await screen.findByText(/all queues are clear/i)).toBeInTheDocument();
  });

  it("shows an error state when any of the three queries fails", async () => {
    mocks.listReports.mockRejectedValue(new Error("reports down"));
    mocks.listAdminContent.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
    });
    mocks.getAdminOverview.mockResolvedValue({ metrics: [{ id: "reports", value: 0 }] });
    renderPage();

    expect(
      await screen.findByText(/moderation data unavailable/i, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("reports down")).toBeInTheDocument();
  });
});
