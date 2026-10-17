import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminReportsPage from "../app/admin/reports/page";
import { api } from "../lib/api";

const mocks = vi.hoisted(() => ({
  items: [] as import("../lib/pageTypes").ReportRecord[],
  invalidate: vi.fn(),
  claimReport: vi.fn(),
  resolveReport: vi.fn(),
  dismissReport: vi.fn(),
}));
vi.mock("../lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      claimReport: mocks.claimReport,
      resolveReport: mocks.resolveReport,
      dismissReport: mocks.dismissReport,
    },
  };
});
vi.mock("../hooks/admin/useAdminList", () => ({
  useAdminList: () => ({
    session: { isLoading: false, isAdmin: true, user: { id: "admin" } },
    page: 1,
    filters: {},
    items: mocks.items,
    meta: { total: mocks.items.length, totalPages: 1 },
    query: { isLoading: false, isError: false },
    invalidate: mocks.invalidate,
    setPage: vi.fn(),
    setFilter: vi.fn(),
  }),
}));
vi.mock("../components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children: import("react").ReactNode }) => <main>{children}</main>,
}));

const report = {
  id: "report-1",
  gameId: null,
  game: null,
  targetType: "POST",
  targetId: "post-1",
  reasonCode: "OTHER",
  createdAt: "2026-10-15T00:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminReportsPage />
    </QueryClientProvider>,
  );
}

describe("AdminReportsPage game context", () => {
  beforeEach(() => {
    mocks.claimReport.mockResolvedValue({});
    mocks.resolveReport.mockResolvedValue({});
    mocks.dismissReport.mockResolvedValue({});
  });

  it.each([
    ["PENDING", "Claim"],
    ["IN_REVIEW", "Review"],
  ] as const)(
    "safely disables %s personal report actions without invoking a game route",
    (status, action) => {
      mocks.items = [{ ...report, status }];
      renderPage();
      expect(screen.getByText("General / Platform")).toBeInTheDocument();
      expect(
        screen.getByText("Platform report moderation is not available yet."),
      ).toBeInTheDocument();
      const button = screen.getByRole("button", { name: `${action} report-1` });
      expect(button).toBeDisabled();
      expect(() => fireEvent.click(button)).not.toThrow();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(api.claimReport).not.toHaveBeenCalled();
      expect(api.resolveReport).not.toHaveBeenCalled();
      expect(api.dismissReport).not.toHaveBeenCalled();
    },
  );

  it("keeps game-backed claims unchanged", async () => {
    mocks.items = [
      {
        ...report,
        status: "PENDING",
        gameId: "game-1",
        game: { slug: "community", name: "Community" },
      },
    ];
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Claim report-1" }));
    await waitFor(() => expect(api.claimReport).toHaveBeenCalledWith("community", "report-1"));
  });

  it.each([
    ["RESOLVE", "Resolve report", "resolveReport"],
    ["DISMISS", "Dismiss report", "dismissReport"],
  ] as const)("keeps game-backed %s decisions unchanged", async (decision, label, method) => {
    mocks.items = [
      {
        ...report,
        status: "IN_REVIEW",
        gameId: "game-1",
        game: { slug: "community", name: "Community" },
      },
    ];
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Review report-1" }));
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: decision } });
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(api[method]).toHaveBeenCalledWith("community", "report-1", { resolutionNote: "" }),
    );
  });
});
