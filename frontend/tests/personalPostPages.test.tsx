import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import PostDetailPage from "../app/post/[id]/page";
import ProfilePage from "../app/profile/page";
import ExplorePage from "../app/explore/page";
import { PostItem } from "../components/PostList";
import { normalizePost } from "../lib/api";

const fixture = vi.hoisted(() => ({ post: null as ReturnType<typeof normalizePost> | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ id: "personal-page" }),
  useSearchParams: () => new URLSearchParams("q=Personal"),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "author" }, isAuthenticated: true }),
}));
vi.mock("../hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({
    user: { id: "author", name: "Page Author", email: "author@example.invalid" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => ({
    data:
      options.queryKey[0] === "posts"
        ? options.queryKey[1] === "detail"
          ? fixture.post
          : { items: [fixture.post], meta: { total: 1 } }
        : { items: [] },
    isLoading: false,
    isError: false,
  }),
}));

function mount(ui: import("react").ReactNode) {
  fixture.post = normalizePost({
    id: "personal-page",
    title: "",
    content: "Personal story",
    gameId: null,
    game: null,
    type: null,
    categoryId: null,
    author: { id: "author", name: "Page Author" },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("personal post page rendering", () => {
  it("renders the actual detail page without Game metadata", () => {
    const { container } = mount(<PostDetailPage />);
    expect(screen.getAllByText("Personal story").length).toBeGreaterThan(0);
    expect(container.querySelector(".post-content-link small")).toHaveTextContent("Page Author");
    expect(container.textContent).not.toMatch(/undefined|null/);
  });

  it("renders personal posts in the actual profile Posts tab", () => {
    const { container } = mount(<ProfilePage />);
    fireEvent.click(screen.getByRole("tab", { name: /^Posts/ }));
    expect(screen.getByRole("link", { name: /Personal story/ })).toHaveAttribute(
      "href",
      "/post/personal-page",
    );
    expect(container.querySelector(".post-content-link small")).toHaveTextContent("Page Author");
  });

  it("renders personal posts in actual Explore search results", () => {
    const { container } = mount(<ExplorePage />);
    expect(screen.getByRole("link", { name: /Personal story/ })).toHaveAttribute(
      "href",
      "/post/personal-page",
    );
    expect(container.querySelector(".post-content-link small")).toHaveTextContent("Page Author");
    expect(
      container.querySelector('a[href*="/community/undefined"], a[href*="/community/null"]'),
    ).toBeNull();
  });

  it("preserves community metadata on the shared post renderer", () => {
    const { container } = mount(
      <PostItem
        post={normalizePost({
          id: "community-page",
          title: "Community story",
          content: "Body",
          game: { name: "Real Community", slug: "real-community" },
          type: "GUIDE",
          author: { id: "author", name: "Page Author" },
        })}
      />,
    );
    expect(container.querySelector(".post-content-link small")).toHaveTextContent(
      "Real Community - Page Author",
    );
  });
});
