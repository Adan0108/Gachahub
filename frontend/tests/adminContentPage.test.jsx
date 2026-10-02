import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminContentPage from "../app/admin/content/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/content",
}));

vi.mock("../hooks/useRequireAdmin", () => ({
  useRequireAdmin: () => ({
    user: { id: "admin-1", name: "Admin" },
    isAdmin: true,
    isLoading: false,
  }),
}));

const mocks = vi.hoisted(() => ({
  listAdminContent: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    listAdminContent: mocks.listAdminContent,
    hideContent: vi.fn(),
    restoreContent: vi.fn(),
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
      <AdminContentPage />
    </QueryClientProvider>,
  );
}

const baseItem = {
  id: "post-1",
  type: "POST",
  title: "Version guide discussion",
  authorName: "Rover",
  status: "PUBLISHED",
  reportCount: 4,
  gameSlug: "wuthering-waves",
};

describe("AdminContentPage status-based actions", () => {
  beforeEach(() => {
    mocks.listAdminContent.mockReset();
  });

  it("offers Hide for published content", async () => {
    mocks.listAdminContent.mockResolvedValue({
      items: [baseItem],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(await screen.findByRole("button", { name: /hide post post-1/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /restore post post-1/i })).not.toBeInTheDocument();
  });

  it("offers Restore for hidden content", async () => {
    mocks.listAdminContent.mockResolvedValue({
      items: [{ ...baseItem, status: "HIDDEN" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(
      await screen.findByRole("button", { name: /restore post post-1/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^hide post post-1/i })).not.toBeInTheDocument();
  });

  it("sends the content type filter to the server instead of filtering client-side", async () => {
    mocks.listAdminContent.mockImplementation(({ type } = {}) =>
      Promise.resolve({
        items:
          type === "COMMENT"
            ? [{ ...baseItem, id: "comment-1", type: "COMMENT", title: "A comment" }]
            : [baseItem],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
    );
    renderPage();

    await screen.findByText("Version guide discussion");
    const select = screen.getByRole("combobox", { name: /filter content type/i });
    fireEvent.change(select, { target: { value: "COMMENT" } });

    expect(await screen.findByText("A comment")).toBeInTheDocument();
    expect(screen.queryByText("Version guide discussion")).not.toBeInTheDocument();
    expect(mocks.listAdminContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "COMMENT" }),
      expect.anything(),
    );
  });

  it("keeps the pager visible when a client-side search filters out every row on the page", async () => {
    mocks.listAdminContent.mockResolvedValue({
      items: [baseItem],
      meta: { page: 1, limit: 20, total: 1, totalPages: 2 },
    });
    renderPage();

    await screen.findByText("Version guide discussion");
    fireEvent.change(screen.getByRole("textbox", { name: /search content/i }), {
      target: { value: "nothing matches this" },
    });

    expect(await screen.findByText(/no content found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });
});
