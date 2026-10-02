import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminUsersPage from "../app/admin/users/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/users",
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
}));

vi.mock("../lib/api", () => ({
  api: {
    listAdminUsers: mocks.listAdminUsers,
    setUserStatus: vi.fn(),
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
      <AdminUsersPage />
    </QueryClientProvider>,
  );
}

const baseUser = {
  id: "user-1",
  name: "Rover",
  email: "rover@example.com",
  role: "USER",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("AdminUsersPage status-based actions", () => {
  beforeEach(() => {
    mocks.listAdminUsers.mockReset();
  });

  it("offers Reactivate for a suspended user", async () => {
    mocks.listAdminUsers.mockResolvedValue({
      items: [{ ...baseUser, status: "SUSPENDED" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(await screen.findByRole("button", { name: /reactivate rover/i })).toBeInTheDocument();
  });

  it("offers no restriction action for a deleted account", async () => {
    mocks.listAdminUsers.mockResolvedValue({
      items: [{ ...baseUser, status: "DELETED" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    await screen.findByText("Rover");
    expect(screen.queryByRole("button", { name: /reactivate rover/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /restrict rover/i })).not.toBeInTheDocument();
  });

  it("offers no reactivate action for a non-active admin row", async () => {
    mocks.listAdminUsers.mockResolvedValue({
      items: [{ ...baseUser, role: "ADMIN", status: "BANNED" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    await screen.findByText("Rover");
    expect(screen.queryByRole("button", { name: /reactivate rover/i })).not.toBeInTheDocument();
  });

  it("disables Restrict for an active admin row", async () => {
    mocks.listAdminUsers.mockResolvedValue({
      items: [{ ...baseUser, role: "ADMIN", status: "ACTIVE" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(await screen.findByRole("button", { name: /restrict rover/i })).toBeDisabled();
  });
});
