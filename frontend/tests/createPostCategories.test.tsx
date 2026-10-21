import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import CreatePostPage from "../app/create/page";

const mocks = vi.hoisted(() => ({
  createPost: vi.fn((_post: unknown) => Promise.resolve({ id: "new-post" })),
  uploadPostMedia: vi.fn(() => Promise.resolve({ successful: [], failed: [] })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => ({
    data:
      options.queryKey[0] === "games"
        ? {
            items: [
              { id: "g1", slug: "game-one", name: "Game One" },
              { id: "g2", slug: "game-two", name: "Game Two" },
            ],
          }
        : options.queryKey[1] === "game-one"
          ? [
              { id: "general", slug: "general", name: "General" },
              { id: "guide", slug: "guides", name: "Guides" },
              { id: "inactive", slug: "inactive", name: "Inactive", isActive: false },
            ]
          : [{ id: "news", slug: "news", name: "News" }],
    isLoading: false,
    isError: false,
  }),
}));

beforeEach(() => vi.clearAllMocks());
function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreatePostPage />
    </QueryClientProvider>,
  );
}

it("shows only the selected game's active categories and clears stale selections", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Post to"), { target: { value: "g1" } });
  expect(screen.queryByLabelText("Post type")).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Guides" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Inactive" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "guide" } });
  fireEvent.change(screen.getByLabelText("Post to"), { target: { value: "g2" } });
  expect(screen.getByLabelText("Category")).toHaveValue("");
  expect(screen.queryByRole("option", { name: "Guides" })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "News" })).toBeInTheDocument();
});

it("uses the game's General category without a duplicate post type", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Post to"), { target: { value: "g1" } });
  fireEvent.change(screen.getByPlaceholderText("Give your post a clear title"), {
    target: { value: "New post" },
  });
  fireEvent.change(screen.getByPlaceholderText("Write your post..."), {
    target: { value: "Post content" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Publish post" }));
  await waitFor(() => expect(mocks.createPost).toHaveBeenCalled());
  expect(mocks.createPost).toHaveBeenCalledWith(
    expect.objectContaining({ gameId: "g1", categoryId: "general" }),
  );
  expect(mocks.createPost.mock.calls[0]?.[0]).not.toHaveProperty("type");
});

it("keeps personal posts free of game classification", async () => {
  mount();
  expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("Write your post..."), {
    target: { value: "Personal post" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Publish post" }));
  await waitFor(() => expect(mocks.createPost).toHaveBeenCalled());
  expect(mocks.createPost).toHaveBeenCalledWith(expect.objectContaining({ gameId: null }));
  expect(mocks.createPost.mock.calls[0]?.[0]).not.toHaveProperty("categoryId");
});
