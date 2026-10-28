import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminCategoriesPage from "../app/admin/communities/[slug]/categories/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/communities/wuthering-waves/categories",
  useParams: () => ({ slug: "wuthering-waves" }),
}));

vi.mock("../hooks/admin/useRequireAdmin", () => ({
  useRequireAdmin: () => ({
    user: { id: "admin-1", name: "Admin" },
    isAdmin: true,
    isLoading: false,
  }),
}));

const mocks = vi.hoisted(() => ({
  getCommunity: vi.fn(),
  getCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    getCommunity: mocks.getCommunity,
    getCategories: mocks.getCategories,
    createCategory: mocks.createCategory,
    updateCategory: mocks.updateCategory,
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
      <AdminCategoriesPage />
    </QueryClientProvider>,
  );
}

const category = {
  id: "category-1",
  name: "Guides",
  slug: "guides",
  description: "How-to posts",
  sortOrder: 0,
  isActive: true,
};

describe("AdminCategoriesPage", () => {
  beforeEach(() => {
    mocks.getCommunity.mockReset().mockResolvedValue({ name: "Wuthering Waves" });
    mocks.getCategories.mockReset();
    mocks.createCategory.mockReset().mockResolvedValue({});
    mocks.updateCategory.mockReset().mockResolvedValue({});
  });

  it("lists categories for the community in the URL", async () => {
    mocks.getCategories.mockResolvedValue([category]);
    renderPage();

    expect(await screen.findByText("Guides")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Wuthering Waves" })).toBeInTheDocument();
  });

  it("shows an empty state when the community has no categories", async () => {
    mocks.getCategories.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no categories found/i)).toBeInTheDocument();
  });

  it("sends the active filter to the server", async () => {
    mocks.getCategories.mockResolvedValue([category]);
    renderPage();

    await screen.findByText("Guides");
    fireEvent.change(screen.getByLabelText(/filter category status/i), {
      target: { value: "true" },
    });

    expect(await screen.findByText("Guides")).toBeInTheDocument();
    expect(mocks.getCategories).toHaveBeenLastCalledWith(
      "wuthering-waves",
      { isActive: "true" },
      expect.anything(),
    );
  });

  it("opens the edit form for an existing category", async () => {
    mocks.getCategories.mockResolvedValue([category]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /edit guides/i }));

    expect(screen.getByRole("heading", { name: /update category/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Guides")).toBeInTheDocument();
  });
});
