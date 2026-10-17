import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostItem } from "../components/PostList";
import { removePostFromCache } from "../lib/removePostFromCache";

const mocks = vi.hoisted(() => ({ deletePost: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me" }, isAuthenticated: true }),
}));
vi.mock("../lib/api", () => ({
  fallbackGames: vi.fn(),
  fallbackGame: vi.fn(),
  fallbackCategories: vi.fn(),
  fallbackPosts: vi.fn(),
  api: { deletePost: mocks.deletePost, getComments: () => Promise.resolve({ items: [] }) },
}));

const post = { id: "p1", title: "My post", authorId: "me" };
function setup(detail = false, authorId = "me") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["posts", "mine"], { items: [post], meta: { total: 1 } });
  render(
    <QueryClientProvider client={client}>
      <PostItem post={{ ...post, authorId }} detail={detail} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /more options/i }));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("post deletion", () => {
  it("does not offer delete on another user's post", () => {
    setup(false, "someone-else");
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("requires confirmation and lets the author cancel", () => {
    setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(mocks.deletePost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes the post and updates its list count on success", async () => {
    mocks.deletePost.mockResolvedValue({});
    const client = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete post" }));
    await waitFor(() =>
      expect(client.getQueryData(["posts", "mine"])).toEqual({ items: [], meta: { total: 0 } }),
    );
    expect(mocks.deletePost).toHaveBeenCalledWith("p1");
    expect(screen.queryByText("My post")).not.toBeInTheDocument();
  });

  it("keeps the post and count when deletion fails", async () => {
    mocks.deletePost.mockRejectedValue(new Error("Unable to delete"));
    const client = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to delete");
    expect(client.getQueryData(["posts", "mine"])).toEqual({ items: [post], meta: { total: 1 } });
  });

  it("returns to the feed after deletion on the post page", async () => {
    mocks.deletePost.mockResolvedValue({});
    setup(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete post" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
  });

  it("removes posts across cursor pages and leaves other posts untouched", () => {
    const data = {
      pages: [{ items: [post, { id: "p2" }], meta: { nextCursor: "p1", total: 2 } }],
      pageParams: [undefined],
    };
    expect(removePostFromCache(data, "p1")).toEqual({
      pages: [{ items: [{ id: "p2" }], meta: { nextCursor: "p1", total: 1 } }],
      pageParams: [undefined],
    });
    expect(data.pages[0]?.items).toHaveLength(2);
  });
});
